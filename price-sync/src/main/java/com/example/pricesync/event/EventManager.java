package com.example.pricesync.event;

import com.example.pricesync.api.ApiClient;
import com.example.pricesync.cache.CacheManager;
import com.example.pricesync.config.ConfigManager;
import com.example.pricesync.gui.GuiReader;
import com.example.pricesync.parser.GuiParser;
import com.example.pricesync.parser.PriceParser;
import com.example.pricesync.scheduler.Scheduler;
import com.example.pricesync.util.JsonBuilder;
import com.example.pricesync.util.Logger;
import com.example.pricesync.util.PriceEntry;
import com.example.pricesync.util.ServerIdentity;
import com.example.pricesync.util.CommandDetector;
import com.example.pricesync.util.DetectedCommand;
import com.example.pricesync.util.CommandHistory;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.message.v1.ClientSendMessageEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.inventory.ContainerInput;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Objects;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Wires Fabric lifecycle/network events to the read -> parse -> compare -> send pipeline,
 * matching the EVENT FLOW section of the project spec.
 *
 * GUI-open detection uses Fabric's ScreenEvents plus a tick-based poll. A screen
 * is considered eligible only after the client has sent a server price
 * command (known commands such as /worth or /sellmulti, or a command the mod has
 * learned from a manually opened price GUI), which prevents unrelated container screens from
 * being parsed accidentally. The poll catches page/category changes that update
 * slot contents without recreating the screen.
 *
 * runNow() is also available for the manual keybind (updateMode: refresh_button).
 */
public class EventManager {

    /** How often (in client ticks, 20/sec) to re-check the open GUI for page/category changes. */
    private static final int POLL_INTERVAL_TICKS = 10; // ~twice per second; catches transient navigation updates without a tight loop
    private static final long PRICE_SCREEN_WAIT_TIMEOUT_MS = 10_000;
    private static final long ALTERNATE_COMMAND_DELAY_MS = 1_500;

    /**
     * Price GUIs are often paginated (for example "WORTH (1/55)"). The old
     * implementation only re-read the page the player happened to be on; it
     * never advanced the GUI, so a large price list could permanently stop at
     * the first page (for example ~398 items) even after repeated syncs.
     *
     * We prefer an explicit page/total pair, but also support GUIs whose title
     * does not expose pagination.  In that fallback mode we click only a
     * clearly-labelled next-page control and require the menu fingerprint to
     * change before clicking again.  A repeated/unchanged fingerprint stops the
     * walk, so we never click blindly forever.
     */
    private static final Pattern PAGE_PATTERN =
            Pattern.compile("\\((\\d+)\\s*/\\s*(\\d+)\\)|\\[(\\d+)\\s*/\\s*(\\d+)\\]|\\bpage\\s+(\\d+)\\s+of\\s+(\\d+)\\b|\\bหน้า\\s*(\\d+)\\s*(?:จาก|/)\\s*(\\d+)\\b|\\b(\\d+)\\s*/\\s*(\\d+)\\b",
                    Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CHARACTER_CLASS);
    private static final long PAGE_CLICK_COOLDOWN_MS = 500;
    private static final long PAGE_CHANGE_TIMEOUT_MS = 7_500;
    private static final long NEXT_CONTROL_RETRY_TIMEOUT_MS = 8_000;
    private static final int MAX_NEXT_CONTROL_MISSING_RETRIES = 6;
    private static final int MAX_PAGE_CHANGE_RETRIES = 4;

    private final ConfigManager configManager;
    private final GuiReader guiReader;
    private final GuiParser guiParser;
    private final PriceParser priceParser;
    private final JsonBuilder jsonBuilder;
    private final CacheManager cacheManager;
    private final ApiClient apiClient;
    private final Scheduler scheduler;
    private final CommandHistory commandHistory;

    private int tickCounter = 0;
    private volatile long lastSyncEpochMs = 0;
    private volatile int lastSyncedCount = 0;
    private volatile DetectedCommand detectedCommand;
    private volatile List<DetectedCommand> detectedCommands = List.of();
    private volatile String activePriceServer;
    /** Explicitly sent command currently being correlated with a new price GUI. */
    private volatile String pendingCommandCandidate;
    private boolean priceScreenActive = false;
    private Screen confirmedPriceScreen = null;
    private boolean awaitingPriceScreen = false;
    private long awaitingPriceScreenUntilMs = 0;
    private long awaitingPriceScreenStartedMs = 0;
    private boolean alternateCommandTried = false;
    /**
     * True since the FIRST confirmed price GUI of this connection. Many economy
     * plugins re-open the inventory — a brand-new AbstractContainerScreen
     * instance — for every category or page switch. Eligibility tied to one
     * Screen instance died at exactly that moment (symptom: the second category
     * never auto-paged). This flag lets recreated instances resume tracking
     * without a fresh command; it is cleared on JOIN/DISCONNECT only.
     */
    private boolean priceSessionActive = false;

    private final Set<Integer> visitedPricePages = new HashSet<>();
    private int paginationTotalPages = 0;
    private long lastPageClickAtMs = 0;
    private int pageWaitingFor = -1;
    private long pageWaitingSinceMs = 0;
    private int pageChangeRetryCount = 0;
    private int lastObservedPage = -1;
    /** Unknown-title pagination fallback: remember the current view and wait for it to change after a click. */
    private String pendingUnknownPageFingerprint = null;
    private long pendingUnknownPageSinceMs = 0;
    private final Set<String> visitedUnknownPageFingerprints = new HashSet<>();
    /** Prevents a missing navigation control from being treated as final immediately. */
    private long nextControlMissingSinceMs = 0;
    private int nextControlMissingRetryCount = 0;
    /** Identity of the last navigation control that actually advanced the GUI.
     *  Some unlabelled menus render the same Arrow control on every page but only
     *  expose its navigation lore intermittently. Remembering the successful
     *  control lets later pages reuse that proven signal without treating an
     *  arbitrary right-edge product as Next.
     */
    private int lastSuccessfulNextSlot = -1;
    private String lastSuccessfulNextRegistryId = null;
    /** True when the previous stable view contained at least one priced entry. */
    private boolean lastViewHadPriceEntries = false;
    /** Accumulates every parsed item across pages/categories during one browsing session. */
    private final Map<String, PriceEntry> sessionEntries = new LinkedHashMap<>();
    private String lastCategorySignature = null;
    private String lastMenuFingerprint = null;
    /** Screen/menu that existed when the current price command was sent.
     *  A pre-existing container must never be mistaken for the command's response GUI. */
    private Screen screenBeforePriceCommand = null;
    private net.minecraft.world.inventory.AbstractContainerMenu menuBeforePriceCommand = null;
    /** Snapshot of the pre-command menu contents, used when a server reuses the same screen instance. */
    private List<ItemStack> slotsBeforePriceCommand = List.of();

    public EventManager(
            ConfigManager configManager,
            GuiReader guiReader,
            GuiParser guiParser,
            PriceParser priceParser,
            JsonBuilder jsonBuilder,
            CacheManager cacheManager,
            ApiClient apiClient,
            Scheduler scheduler
    ) {
        this.configManager = configManager;
        this.guiReader = guiReader;
        this.guiParser = guiParser;
        this.priceParser = priceParser;
        this.jsonBuilder = jsonBuilder;
        this.cacheManager = cacheManager;
        this.apiClient = apiClient;
        this.scheduler = scheduler;
        this.commandHistory = new CommandHistory();
        this.apiClient.setSuccessListener(this::onPayloadAccepted);
    }

    public void registerAll() {
        // Player joined server -> start scheduler if in automatic mode.
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            detectedCommand = null;
            detectedCommands = List.of();
            activePriceServer = null;
            priceScreenActive = false;
            confirmedPriceScreen = null;
            awaitingPriceScreen = false;
            awaitingPriceScreenUntilMs = 0;
            awaitingPriceScreenStartedMs = 0;
            alternateCommandTried = false;
            screenBeforePriceCommand = null;
            menuBeforePriceCommand = null;
            slotsBeforePriceCommand = List.of();
            resetSessionNavigationEvidence();
            priceSessionActive = false;
            sessionEntries.clear();
            lastCategorySignature = null;
            lastMenuFingerprint = null;
            activePriceServer = ServerIdentity.getCurrent();
            detectedCommand = selectPriceCommand(activePriceServer);
            pendingCommandCandidate = null;
            Logger.info("Joined server; detected price command=" + (detectedCommand == null ? "none" : detectedCommand.literal()));
            scheduler.start(() -> client.execute(this::runAutomaticTick));
            // In "manual" mode nothing runs here — the open/poll hooks below
            // fire the pipeline whenever the player opens/browses the learned price GUI.
        });

        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            scheduler.stop();
            detectedCommand = null;
            detectedCommands = List.of();
            activePriceServer = null;
            priceScreenActive = false;
            confirmedPriceScreen = null;
            awaitingPriceScreen = false;
            awaitingPriceScreenUntilMs = 0;
            awaitingPriceScreenStartedMs = 0;
            alternateCommandTried = false;
            screenBeforePriceCommand = null;
            menuBeforePriceCommand = null;
            slotsBeforePriceCommand = List.of();
            resetSessionNavigationEvidence();
            priceSessionActive = false;
            sessionEntries.clear();
            lastCategorySignature = null;
            lastMenuFingerprint = null;
            pendingCommandCandidate = null;
        });

        // Correlate an explicitly sent server command with the GUI it opens.
        // The server is allowed to use any command name; /worth and /sellmulti
        // are only known built-ins, not a whitelist. We never guess by executing
        // arbitrary commands from the command tree.
        ClientSendMessageEvents.COMMAND.register(command -> {
            String root = command == null ? "" : command.trim();
            int space = root.indexOf(' ');
            if (space >= 0) root = root.substring(0, space);
            while (root.startsWith("/")) root = root.substring(1);
            if (root.isBlank() || root.equalsIgnoreCase("pricesync")) return;

            String currentServer = ServerIdentity.getCurrent();
            String learned = commandHistory.get(currentServer);
            String commandRoot = root;
            boolean known = CommandDetector.detectAll().stream().anyMatch(c -> c.name().equalsIgnoreCase(commandRoot));
            if (priceScreenActive && !known
                    && (detectedCommand == null || !root.equalsIgnoreCase(detectedCommand.name()))
                    && (learned == null || !root.equalsIgnoreCase(learned))) {
                // Do not tear down a confirmed price screen merely because the
                // player sent an unrelated command while viewing it.
                return;
            }

            DetectedCommand candidate = new DetectedCommand(root);
            Minecraft client = Minecraft.getInstance();
            String serverIdentity = ServerIdentity.getCurrent();
            if (serverIdentity == null) return;

            // Only one command may own the current GUI-correlation window. If the
            // player sends another command before the first response arrives,
            // do not replace the candidate: otherwise an unrelated command such
            // as /help or /msg could be learned as the price command when the
            // first command's GUI finally appears. The player can simply send
            // the intended price command again after the timeout.
            if (awaitingPriceScreen) {
                Logger.debug("Ignoring command /" + candidate.name() + " while already waiting for /"
                        + (pendingCommandCandidate == null ? "unknown" : pendingCommandCandidate)
                        + " price GUI response.");
                return;
            }

            // A fresh explicit price command starts a fresh collection session.
            // Once its GUI is confirmed, browsing pages/categories accumulates into
            // this same map until the next explicit command or disconnect.
            sessionEntries.clear();
            lastCategorySignature = null;
            lastMenuFingerprint = null;
            resetSessionNavigationEvidence();
            screenBeforePriceCommand = guiReader.getCurrentScreen();
            menuBeforePriceCommand = (client.player != null && screenBeforePriceCommand instanceof AbstractContainerScreen<?> oldContainer)
                    ? oldContainer.getMenu() : null;
            slotsBeforePriceCommand = snapshotMenuSlots(menuBeforePriceCommand);
            awaitingPriceScreen = true;
            awaitingPriceScreenStartedMs = System.currentTimeMillis();
            awaitingPriceScreenUntilMs = awaitingPriceScreenStartedMs + PRICE_SCREEN_WAIT_TIMEOUT_MS;
            alternateCommandTried = false;
            priceScreenActive = false;
            activePriceServer = serverIdentity;
            detectedCommand = candidate;
            pendingCommandCandidate = candidate.name();
            Logger.debug("Server command sent: /" + candidate.name() + "; waiting to see whether it opens a price GUI.");
        });

        // Fires whenever a screen opens. Do NOT parse arbitrary container screens.
        // A screen is eligible only after a known/learned price command was sent, or
        // while an already-confirmed price screen is being refreshed.
        ScreenEvents.AFTER_INIT.register((client, screen, scaledWidth, scaledHeight) -> {
            // A confirmed price GUI is tied to one concrete Screen instance. If
            // the player closes it and opens a chest/shop/etc., the new screen
            // must never inherit priceScreenActive from the old one.
            if (priceScreenActive && screen != confirmedPriceScreen) {
                priceScreenActive = false;
                confirmedPriceScreen = null;
            }
            if (!(screen instanceof AbstractContainerScreen<?> containerScreen)) return;
            if (client.player == null || containerScreen.getMenu() != client.player.containerMenu) return;
            // A recreated instance of the price menu (server re-opened the
            // inventory) resumes tracking through priceSessionActive.
            if (!awaitingPriceScreen && !priceScreenActive && !priceSessionActive) return;

            // While waiting for a command response, this screen must actually be
            // different from the screen/menu that existed when the command was sent.
            // Otherwise a pre-existing chest/shop could be parsed and falsely
            // confirmed as the response to the detected price command.
            if (awaitingPriceScreen
                    && screen == screenBeforePriceCommand
                    && containerScreen.getMenu() == menuBeforePriceCommand) {
                Logger.debug("Ignoring pre-command container while waiting for price GUI.");
                return;
            }

            if (detectedCommand == null) {
                detectedCommand = selectPriceCommand(ServerIdentity.getCurrent());
            }
            if (detectedCommand == null) return;

            activePriceServer = ServerIdentity.getCurrent();
            boolean parsedPriceData = safeRunSyncPipeline();
            if (parsedPriceData) {
                awaitingPriceScreen = false;
                awaitingPriceScreenUntilMs = 0;
                awaitingPriceScreenStartedMs = 0;
                alternateCommandTried = false;
                priceScreenActive = true;
                priceSessionActive = true;
                confirmedPriceScreen = screen;
                resetSessionNavigationEvidence();
                screenBeforePriceCommand = null;
                menuBeforePriceCommand = null;
                slotsBeforePriceCommand = List.of();
                Logger.debug("Confirmed price GUI from parsed price data using /" + detectedCommand.name());
            } else if (awaitingPriceScreen) {
                // Do not immediately switch commands: the server can open the
                // correct GUI before its item/lore data arrives. The tick poll
                // gives the first GUI time to populate before any alternate
                // known command is considered.
                Logger.debug("Command-triggered container opened but no recognizable price data was found yet; waiting for GUI population.");
            }
        });

        // Polls the CURRENTLY open screen's title every POLL_INTERVAL_TICKS.
        // Catches page/category changes that don't fire ScreenEvents.AFTER_INIT
        // (since the screen isn't re-created when you click to another page —
        // only its slot contents change). The cache diff in runSyncPipeline()
        // makes this cheap: nothing gets sent unless prices actually changed.
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            tickCounter++;
            if (tickCounter < POLL_INTERVAL_TICKS) {
                return;
            }
            tickCounter = 0;

            if (detectedCommand == null) {
                detectedCommand = selectPriceCommand(ServerIdentity.getCurrent());
            }
            Screen currentScreen = guiReader.getCurrentScreen();
            String currentTitle = guiReader.getCurrentScreenTitle();
            boolean validContainerScreen = guiReader.isCurrentContainerScreen();
            long now = System.currentTimeMillis();
            if (priceScreenActive && currentScreen != confirmedPriceScreen) {
                priceScreenActive = false;
                confirmedPriceScreen = null;
            }
            if (!validContainerScreen || currentTitle == null) {
                // A command-triggered GUI may take several ticks to arrive. Do not
                // cancel the waiting state merely because there is no screen yet;
                // the explicit timeout below is the single source of truth.
                priceScreenActive = false;
                if (awaitingPriceScreen && now > awaitingPriceScreenUntilMs) {
                    awaitingPriceScreen = false;
                    awaitingPriceScreenUntilMs = 0;
                    awaitingPriceScreenStartedMs = 0;
                    alternateCommandTried = false;
                    screenBeforePriceCommand = null;
                    menuBeforePriceCommand = null;
                    slotsBeforePriceCommand = List.of();
                    pendingCommandCandidate = null;
                    // The candidate was never proven to be a price command.
                    // Do not leave an arbitrary user command (e.g. /help) in
                    // detectedCommand, because automatic mode could otherwise
                    // execute that stale command again on the next interval.
                    detectedCommand = null;
                    Logger.debug("Timed out waiting for the price GUI after the detected command.");
                }
                return;
            }
            if (awaitingPriceScreen && now > awaitingPriceScreenUntilMs) {
                awaitingPriceScreen = false;
                awaitingPriceScreenUntilMs = 0;
                awaitingPriceScreenStartedMs = 0;
                alternateCommandTried = false;
                screenBeforePriceCommand = null;
                menuBeforePriceCommand = null;
                slotsBeforePriceCommand = List.of();
                pendingCommandCandidate = null;
                // The command was not proven to open the price GUI within the
                // correlation window. Clear it so a random command can never
                // become the next automatic command by stale state.
                detectedCommand = null;
                Logger.debug("Timed out waiting for the price GUI after the detected command.");
            }
            // Never inspect arbitrary containers. Only continue polling after a
            // known/learned price command has opened and been confirmed as a price GUI.
            if (detectedCommand != null && (priceScreenActive || awaitingPriceScreen || priceSessionActive)) {
                boolean parsed = safeRunSyncPipeline();
                if (parsed) {
                    priceScreenActive = true;
                    priceSessionActive = true;
                } else if (awaitingPriceScreen
                        && !alternateCommandTried
                        && System.currentTimeMillis() - awaitingPriceScreenStartedMs >= ALTERNATE_COMMAND_DELAY_MS) {
                    alternateCommandTried = true;
                    tryNextDetectedCommand();
                }
            }
        });
    }

    private void tryNextDetectedCommand() {
        if (!awaitingPriceScreen || System.currentTimeMillis() > awaitingPriceScreenUntilMs
                || detectedCommands.isEmpty() || detectedCommand == null) return;
        int index = detectedCommands.indexOf(detectedCommand);
        if (index < 0) {
            // A previously learned custom command may no longer be advertised
            // by the live command tree. If a known price command is available,
            // use it as a safe recovery candidate after the learned command
            // times out instead of getting stuck forever on stale history.
            detectedCommand = detectedCommands.get(0);
        } else {
            if (index + 1 >= detectedCommands.size()) return;
            detectedCommand = detectedCommands.get(index + 1);
        }
        // The original manually sent command has just failed to produce price
        // data. If we now try a different known command, that original candidate
        // must not be learned when the alternate GUI succeeds.
        pendingCommandCandidate = null;
        awaitingPriceScreenStartedMs = System.currentTimeMillis();
        awaitingPriceScreenUntilMs = awaitingPriceScreenStartedMs + PRICE_SCREEN_WAIT_TIMEOUT_MS;
        var connection = net.minecraft.client.Minecraft.getInstance().getConnection();
        if (connection != null) {
            Minecraft client = Minecraft.getInstance();
            screenBeforePriceCommand = guiReader.getCurrentScreen();
            menuBeforePriceCommand = (client.player != null && screenBeforePriceCommand instanceof AbstractContainerScreen<?> oldContainer)
                    ? oldContainer.getMenu() : null;
            slotsBeforePriceCommand = snapshotMenuSlots(menuBeforePriceCommand);
            Logger.debug("Trying alternate server price command /" + detectedCommand.name());
            connection.sendCommand(detectedCommand.name());
        }
    }

    /**
     * Selects the safest currently usable price command. A learned command wins
     * only while it is still advertised by the live command tree, or while the
     * command tree is not available yet. If a stale learned command disappeared
     * from a populated command tree, prefer the currently advertised known command
     * so automatic mode can recover without requiring manual re-learning.
     */
    private DetectedCommand selectPriceCommand(String serverIdentity) {
        if (serverIdentity == null) return null;
        detectedCommands = CommandDetector.detectAll();
        String learned = commandHistory.get(serverIdentity);
        if (learned != null) {
            boolean advertised = detectedCommands.stream()
                    .anyMatch(command -> command.name().equalsIgnoreCase(learned));
            if (advertised) {
                // Use the exact literal advertised by Brigadier. Learned history
                // is normalized for persistence, but command literals are
                // case-sensitive when sent to the server.
                return detectedCommands.stream()
                        .filter(command -> command.name().equalsIgnoreCase(learned))
                        .findFirst()
                        .orElse(null);
            }
            if (detectedCommands.isEmpty()) {
                // The command tree can be unavailable briefly during JOIN. In
                // that narrow window we may only use the persisted literal; once
                // the live tree arrives selectPriceCommand() will replace it
                // with the exact server-advertised spelling.
                return new DetectedCommand(learned);
            }
            Logger.debug("Learned price command /" + learned
                    + " is no longer advertised; falling back to /" + detectedCommands.get(0).name());
        }
        return detectedCommands.isEmpty() ? null : detectedCommands.get(0);
    }

    /**
     * Reads the page number from titles such as "WORTH (2/55)".
     * Returns {-1, -1} when the title is not explicitly paginated.
     */
    static int[] readPageInfo(String title) {
        if (title == null) return new int[] {-1, -1};
        Matcher matcher = PAGE_PATTERN.matcher(title);
        if (!matcher.find()) return new int[] {-1, -1};
        for (int group = 1; group <= 9; group += 2) {
            String currentText = matcher.group(group);
            String totalText = matcher.group(group + 1);
            if (currentText == null || totalText == null) continue;
            try {
                int current = Integer.parseInt(currentText);
                int total = Integer.parseInt(totalText);
                if (current >= 1 && total >= current) return new int[] {current, total};
            } catch (NumberFormatException ignored) {
                // Try the next supported title format.
            }
        }
        return new int[] {-1, -1};
    }

    /**
     * Finds a clearly-labelled next-page control in the actual container slots.
     * We deliberately do not click a hard-coded slot number because different
     * servers place navigation controls in different positions.
     */
    private int findNextPageSlot(List<com.example.pricesync.gui.GuiReader.SlotSnapshot> viewSlots, boolean explicitPageNeedsNext) {
        if (viewSlots == null || viewSlots.isEmpty() || Minecraft.getInstance().player == null) return -1;

        // Determine geometry in two passes.  Do not update maxX while maxY is
        // still changing: a later (lower) row can start at a smaller x than the
        // previous row, and carrying the previous row's maxX would incorrectly
        // classify the new row's right edge.
        int maxY = Integer.MIN_VALUE;
        for (var snapshot : viewSlots) {
            if (snapshot.stack() == null || snapshot.stack().isEmpty()) continue;
            maxY = Math.max(maxY, snapshot.y());
        }
        if (maxY == Integer.MIN_VALUE) return -1;

        int maxX = Integer.MIN_VALUE;
        for (var snapshot : viewSlots) {
            if (snapshot.stack() == null || snapshot.stack().isEmpty()) continue;
            if (snapshot.y() == maxY) maxX = Math.max(maxX, snapshot.x());
        }
        int bestSlot = -1;
        int bestScore = 0;
        for (int acceptedIndex = 0; acceptedIndex < viewSlots.size(); acceptedIndex++) {
            var snapshot = viewSlots.get(acceptedIndex);
            ItemStack stack = snapshot.stack();
            if (stack == null || stack.isEmpty()) continue;

            GuiParser.ParsedItem parsed = guiParser.parse(stack);
            // A real priced item is never a navigation control. This is especially
            // important for Arrow/Spectral Arrow products on servers where the next
            // button uses the same item icon as a sellable item.
            if (priceParser.parse(parsed).isPresent()) continue;

            StringBuilder text = new StringBuilder(stack.getHoverName().getString());
            var lore = stack.get(net.minecraft.core.component.DataComponents.LORE);
            if (lore != null) {
                for (var line : lore.lines()) text.append(' ').append(line.getString());
            }
            String normalized = text.toString().toLowerCase(java.util.Locale.ROOT).trim();
            int score = 0;
            boolean labelledNext = false;
            boolean labelledPrevious = false;

            if (normalized.contains("previous page") || normalized.contains("prev page")
                    || normalized.contains("previous") || normalized.contains("prev")
                    || normalized.contains("หน้าก่อน") || normalized.contains("ย้อนกลับ")
                    || normalized.contains("กลับหมวดหมู่") || normalized.contains("กลับไปหมวดหมู่")) {
                labelledPrevious = true;
            }
            if (normalized.contains("next page") || normalized.contains("next")) { score += 100; labelledNext = true; }
            if (normalized.contains("หน้าถัดไป") || normalized.contains("ถัดไป")) { score += 100; labelledNext = true; }
            if (normalized.contains("หน้าต่อไป") || normalized.contains("ต่อไป")) { score += 100; labelledNext = true; }
            if (normalized.contains("หน้า ") && normalized.contains("ถัด")) { score += 90; labelledNext = true; }
            if (normalized.contains("»") || normalized.contains("→") || normalized.contains("⏩")
                    || normalized.equals(">") || normalized.equals(">>")) score += 40;

            String registryId = net.minecraft.core.registries.BuiltInRegistries.ITEM
                    .getKey(stack.getItem()).toString();
            boolean arrowItem = registryId.equals("minecraft:arrow") || registryId.equals("minecraft:spectral_arrow");
            boolean lastRow = snapshot.y() == maxY;
            boolean rightEdge = lastRow && snapshot.x() == maxX;
            boolean parserNavigation = GuiParser.isNavigationOrCategory(parsed);
            if (labelledPrevious && !labelledNext) continue;

            boolean sameProvenNavigationSlot = snapshot.menuIndex() == lastSuccessfulNextSlot;
            boolean sameProvenNavigationItem = lastSuccessfulNextRegistryId != null
                    && lastSuccessfulNextRegistryId.equals(registryId);

            if (lastRow) score += 15;
            if (parserNavigation) score += 20;
            // Arrow-only navigation is intentionally restricted to the right edge.
            // A non-priced Arrow elsewhere in the last row can still be a legitimate
            // product whose price was not parseable on this poll.
            if (arrowItem && rightEdge) score += 35;
            if (rightEdge && lastRow && parserNavigation) score += 10;

            // Some menus expose the Next control without an Arrow-specific icon or
            // navigation lore on later pages. Once this exact menu slot has already
            // produced a successful page transition, the slot itself is proven for
            // this pagination session. Keep the item identity check as a second guard
            // so a different product cannot inherit the proof merely by occupying the
            // same coordinate. This is still never used before a real click succeeds.
            if (rightEdge && sameProvenNavigationSlot && sameProvenNavigationItem) {
                score += 45;
            } else if (sameProvenNavigationSlot && sameProvenNavigationItem) {
                // The proven control can sit off the computed right edge on some
                // pages (filler panes shift the lowest row, or the control moves
                // rows between categories of the same menu). An UNPRICED instance
                // of the exact item that already advanced this menu from this
                // exact slot is still the control — priced stacks never reach
                // scoring because they are excluded above. This is what keeps a
                // second category paging after the first one proved the control.
                score += 60;
            }

            // Explicit page/total information permits an icon-only fallback, but
            // only when the candidate is itself navigation-like. A generic
            // right-edge item is not enough evidence: many shop GUIs place a real
            // product in that position on the final row.
            if (explicitPageNeedsNext && rightEdge && lastRow
                    && !labelledPrevious && (parserNavigation || arrowItem)) score += 15;

            if (score > bestScore) {
                bestScore = score;
                bestSlot = snapshot.menuIndex();
            }
        }

        int minimumScore = explicitPageNeedsNext ? 55 : 60;
        if (bestSlot >= 0 && bestScore < minimumScore) {
            Logger.debug("Next-page control rejected: best candidate slot "
                    + bestSlot + " scored " + bestScore + ", below the minimum " + minimumScore
                    + ". Enable /pricesync debug to trace future polls.");
        }
        return bestScore >= minimumScore ? bestSlot : -1;
    }

    /**
     * Advances a paginated price GUI after the current page has been parsed.
     * Returns true when a click was sent.
     */
    private boolean advancePricePageIfNeeded(String title, List<PriceEntry> parsedEntries, List<com.example.pricesync.gui.GuiReader.SlotSnapshot> viewSlots) {
        if (title == null || viewSlots == null || viewSlots.isEmpty()) return false;

        int[] page = readPageInfo(title);
        int currentPage = page[0];
        int totalPages = page[1];

        // Preferred path: the title explicitly tells us the current/total page.
        if (currentPage >= 1 && totalPages >= currentPage) {
            paginationTotalPages = totalPages;
            pendingUnknownPageFingerprint = null;
            pendingUnknownPageSinceMs = 0;

            if (lastObservedPage >= 0 && currentPage < lastObservedPage) {
                // A backwards jump normally means the player returned to the
                // category menu and opened a new category.  Do not keep the old
                // page number alive across that transition.
                resetPaginationState();
            }
            if (lastObservedPage >= 0 && currentPage == lastObservedPage) {
                // Same page can be polled repeatedly while waiting for a click.
                // This is not an error by itself; the waiting state below handles it.
            }
            lastObservedPage = currentPage;
            visitedPricePages.add(currentPage);

            if (currentPage >= totalPages) {
                pageWaitingFor = -1;
                pageWaitingSinceMs = 0;
                nextControlMissingSinceMs = 0;
                Logger.info("Finished paginated price GUI: " + visitedPricePages.size()
                        + "/" + totalPages + " page(s), " + parsedEntries.size()
                        + " item(s) on the final page.");
                return false;
            }

            long now = System.currentTimeMillis();
            if (pageWaitingFor == currentPage) {
                if (now - pageWaitingSinceMs < PAGE_CHANGE_TIMEOUT_MS) return false;
                if (pageChangeRetryCount < MAX_PAGE_CHANGE_RETRIES) {
                    pageChangeRetryCount++;
                    pageWaitingFor = -1;
                    pageWaitingSinceMs = 0;
                    Logger.warn("Price GUI stayed on page " + currentPage + "/" + totalPages
                            + "; retrying next-page click (" + pageChangeRetryCount
                            + "/" + MAX_PAGE_CHANGE_RETRIES + ").");
                    return clickNextPage("page " + currentPage + "/" + totalPages + " retry", true, title, viewSlots);
                }
                Logger.warn("Price GUI stayed on page " + currentPage + "/" + totalPages
                        + " after " + MAX_PAGE_CHANGE_RETRIES + " next-page retries; stopping pagination.");
                return false;
            }
            pageChangeRetryCount = 0;
            return clickNextPage("page " + currentPage + "/" + totalPages, true, title, viewSlots);
        }

        // Fallback path: some server menus do not put (current/total) in the
        // title.  The next-page control itself is still enough to walk safely if
        // we require the visible menu contents to change after every click.
        String fingerprint = lastMenuFingerprint;
        if (fingerprint == null || fingerprint.isBlank()) return false;

        if (pendingUnknownPageFingerprint != null) {
            if (fingerprint.equals(pendingUnknownPageFingerprint)) {
                long now = System.currentTimeMillis();
                if (now - pendingUnknownPageSinceMs < PAGE_CHANGE_TIMEOUT_MS) return false;
                if (pageChangeRetryCount < MAX_PAGE_CHANGE_RETRIES) {
                    pageChangeRetryCount++;
                    pendingUnknownPageFingerprint = null;
                    pendingUnknownPageSinceMs = 0;
                    visitedUnknownPageFingerprints.remove(fingerprint);
                    Logger.warn("Unlabelled price GUI did not change after next-page click; retrying ("
                            + pageChangeRetryCount + "/" + MAX_PAGE_CHANGE_RETRIES + ").");
                    return clickNextPage("unlabelled page retry", false, title, viewSlots);
                }
                Logger.warn("Unlabelled price GUI did not change after " + MAX_PAGE_CHANGE_RETRIES
                        + " next-page retries; stopping pagination.");
                return false;
            }
            pendingUnknownPageFingerprint = null;
            pendingUnknownPageSinceMs = 0;
            pageChangeRetryCount = 0;
        }

        if (visitedUnknownPageFingerprints.contains(fingerprint)) {
            Logger.info("Reached a previously seen price-GUI view without explicit page numbers; stopping pagination.");
            return false;
        }

        // Only mark a page as visited after a click is actually issued. If the
        // navigation control is temporarily unavailable, the next poll must be
        // allowed to discover it rather than permanently treating this page as
        // terminal.
        if (clickNextPage("unlabelled page view", false, title, viewSlots)) {
            visitedUnknownPageFingerprints.add(fingerprint);
            return true;
        }
        return false;
    }

    private boolean clickNextPage(String context, boolean explicitPageNeedsNext, String viewTitle, List<com.example.pricesync.gui.GuiReader.SlotSnapshot> viewSlots) {
        long now = System.currentTimeMillis();
        if (now - lastPageClickAtMs < PAGE_CLICK_COOLDOWN_MS) return false;

        Minecraft client = Minecraft.getInstance();
        if (client.player == null || client.gameMode == null
                || !(guiReader.getCurrentScreen() instanceof AbstractContainerScreen<?> screen)
                || screen.getMenu() != client.player.containerMenu) {
            return false;
        }

        int nextSlot = findNextPageSlot(viewSlots, explicitPageNeedsNext);
        if (nextSlot < 0) {
            if (nextControlMissingSinceMs == 0) nextControlMissingSinceMs = now;
            long missingFor = now - nextControlMissingSinceMs;
            if (missingFor < NEXT_CONTROL_RETRY_TIMEOUT_MS) {
                Logger.debug("Next-page control not visible on " + context
                        + "; will retry before declaring the page terminal.");
                return false;
            }
            // A missing control is not proof of the final page. Servers can update
            // navigation slots asynchronously, especially after category changes.
            // Keep polling for a bounded number of intervals; if the control never
            // appears, stop rather than leaving the pagination state alive forever.
            nextControlMissingRetryCount++;
            if (nextControlMissingRetryCount > MAX_NEXT_CONTROL_MISSING_RETRIES) {
                Logger.warn("No next-page control found on " + context + " after "
                        + MAX_NEXT_CONTROL_MISSING_RETRIES + " retry intervals; stopping pagination.");
                nextControlMissingSinceMs = 0;
                nextControlMissingRetryCount = 0;
                return false;
            }
            nextControlMissingSinceMs = now;
            Logger.warn("No next-page control found on " + context
                    + " for " + missingFor + "ms; continuing bounded retry polling ("
                    + nextControlMissingRetryCount + "/" + MAX_NEXT_CONTROL_MISSING_RETRIES + ").");
            return false;
        }
        nextControlMissingSinceMs = 0;
        nextControlMissingRetryCount = 0;

        client.gameMode.handleContainerInput(
                screen.getMenu().containerId,
                nextSlot,
                0,
                ContainerInput.PICKUP,
                client.player);

        // Remember only a control that we actually clicked. This is intentionally
        // updated after all safety checks above so an unavailable/ambiguous slot
        // can never become a trusted navigation signal.
        for (var clickedSnapshot : viewSlots) {
            if (clickedSnapshot.menuIndex() != nextSlot) continue;
            lastSuccessfulNextSlot = clickedSnapshot.menuIndex();
            lastSuccessfulNextRegistryId = net.minecraft.core.registries.BuiltInRegistries.ITEM
                    .getKey(clickedSnapshot.stack().getItem()).toString();
            break;
        }

        lastPageClickAtMs = now;
        // Use the exact title captured by the same ViewSnapshot that led to this
        // click. Reading the live screen title again here can race a server-side
        // page update and pair slots from page N with a title from page N+1.
        int currentPage = readPageInfo(viewTitle)[0];
        if (currentPage >= 1) {
            pageWaitingFor = currentPage;
            pageWaitingSinceMs = now;
        } else {
            pendingUnknownPageFingerprint = lastMenuFingerprint;
            pendingUnknownPageSinceMs = now;
        }
        Logger.info("Advanced price GUI " + context + " using slot " + nextSlot + ".");
        return true;
    }

    private void resetPaginationState() {
        visitedPricePages.clear();
        paginationTotalPages = 0;
        lastPageClickAtMs = 0;
        pageWaitingFor = -1;
        pageWaitingSinceMs = 0;
        pageChangeRetryCount = 0;
        lastObservedPage = -1;
        pendingUnknownPageFingerprint = null;
        pendingUnknownPageSinceMs = 0;
        visitedUnknownPageFingerprints.clear();
        nextControlMissingSinceMs = 0;
        nextControlMissingRetryCount = 0;
        // NOTE: the proven Next-control identity deliberately SURVIVES this
        // reset. Every page and category inside one browsing session shares the
        // same menu template, so evidence about which slot acts as Next stays
        // valid across a category switch; wiping it here made the second
        // category stop auto-paging whenever its control carried no stable
        // label. Forget that identity only at real session boundaries via
        // resetSessionNavigationEvidence().
    }

    private void resetPaginationForNewCategory() {
        resetPaginationState();
        Logger.debug("Detected a new price category; keeping accumulated items and resetting only pagination state.");
    }

    /**
     * Session-boundary reset: a fresh command, server, or screen template
     * invalidates even the proven Next-control identity.
     */
    private void resetSessionNavigationEvidence() {
        resetPaginationState();
        lastSuccessfulNextSlot = -1;
        lastSuccessfulNextRegistryId = null;
    }

    private String categorySignature(String title) {
        if (title == null) return "";
        return PAGE_PATTERN.matcher(title).replaceAll("").replaceAll("\\s+", " ").trim().toLowerCase(java.util.Locale.ROOT);
    }

    private String menuFingerprint(List<com.example.pricesync.gui.GuiReader.SlotSnapshot> snapshots) {
        // Preserve actual menu slot positions, including empty slots. This avoids
        // treating two pages with the same item types but different placement as
        // the same view, and it also survives custom menus that interleave slots.
        StringBuilder b = new StringBuilder();
        for (var snapshot : snapshots) {
            ItemStack stack = snapshot.stack();
            b.append(snapshot.menuIndex()).append('|');
            if (stack == null || stack.isEmpty()) {
                b.append("<empty>\n");
                continue;
            }
            GuiParser.ParsedItem item = guiParser.parse(stack);
            b.append(item.registryId()).append('|')
                    .append(item.displayName()).append('|')
                    .append(item.variantKey()).append('|');
            for (String line : item.loreLines()) {
                // Price/countdown/progress lore is volatile and must not make an
                // unchanged page look like a brand-new page. Variant identity is
                // already represented by item.variantKey().
                if (GuiParser.isVolatileIdentityLine(line)) continue;
                b.append(line).append('\u001f');
            }
            b.append('\n');
        }
        return sha256Hex(b.toString());
    }

    private String sha256Hex(String value) {
        try {
            var md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] bytes = md.digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(bytes.length * 2);
            for (byte aByte : bytes) hex.append(String.format("%02x", aByte));
            return hex.toString();
        } catch (java.security.GeneralSecurityException e) {
            return java.util.HexFormat.of().formatHex(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
    }

    private int countCategoryMenuMarkersFromSnapshots(List<com.example.pricesync.gui.GuiReader.SlotSnapshot> snapshots) {
        if (snapshots == null || snapshots.isEmpty()) return 0;
        int count = 0;
        for (var snapshot : snapshots) {
            ItemStack stack = snapshot.stack();
            if (stack == null || stack.isEmpty()) continue;
            GuiParser.ParsedItem item = guiParser.parse(stack);
            if (GuiParser.hasCategoryMarker(item)) count++;
        }
        return count;
    }

    private boolean hasCategoryMenuMarkersFromSnapshots(List<com.example.pricesync.gui.GuiReader.SlotSnapshot> snapshots) {
        return countCategoryMenuMarkersFromSnapshots(snapshots) > 0;
    }

    private void runAutomaticTick() {
        // Never issue another price command while the previous one is still
        // waiting for its GUI. This prevents command spam when updateInterval
        // is configured too aggressively or the server is slow to respond.
        if (awaitingPriceScreen) {
            if (System.currentTimeMillis() <= awaitingPriceScreenUntilMs) {
                return;
            }
            awaitingPriceScreen = false;
            awaitingPriceScreenUntilMs = 0;
            awaitingPriceScreenStartedMs = 0;
            alternateCommandTried = false;
            screenBeforePriceCommand = null;
            menuBeforePriceCommand = null;
            slotsBeforePriceCommand = List.of();
            pendingCommandCandidate = null;
            detectedCommand = null;
        }
        if ((guiReader.getCurrentScreen() == confirmedPriceScreen && priceScreenActive)
                || (priceSessionActive && guiReader.isCurrentContainerScreen())) {
            safeRunSyncPipeline();
        } else {
            openDetectedPriceGuiThenSync();
        }
    }

    private void openDetectedPriceGuiThenSync() {
        try {
            if (awaitingPriceScreen) return;
            String currentServer = ServerIdentity.getCurrent();
            DetectedCommand command = selectPriceCommand(currentServer);
            detectedCommand = command;
            if (detectedCommand == null) {
                pendingCommandCandidate = null;
                Logger.warn("No known or learned price command is available on this server. Send the server's price command once manually; the mod will learn it after the resulting price GUI is parsed.");
                return;
            }
            activePriceServer = ServerIdentity.getCurrent();
            sessionEntries.clear();
            lastCategorySignature = null;
            lastMenuFingerprint = null;
            resetSessionNavigationEvidence();
            Minecraft client = Minecraft.getInstance();
            screenBeforePriceCommand = guiReader.getCurrentScreen();
            menuBeforePriceCommand = (client.player != null && screenBeforePriceCommand instanceof AbstractContainerScreen<?> oldContainer)
                    ? oldContainer.getMenu() : null;
            slotsBeforePriceCommand = snapshotMenuSlots(menuBeforePriceCommand);
            awaitingPriceScreen = true;
            awaitingPriceScreenStartedMs = System.currentTimeMillis();
            awaitingPriceScreenUntilMs = awaitingPriceScreenStartedMs + PRICE_SCREEN_WAIT_TIMEOUT_MS;
            alternateCommandTried = false;
            priceScreenActive = false;
            var connection = client.getConnection();
            if (connection == null) {
                awaitingPriceScreen = false;
                awaitingPriceScreenUntilMs = 0;
                awaitingPriceScreenStartedMs = 0;
                alternateCommandTried = false;
                screenBeforePriceCommand = null;
                menuBeforePriceCommand = null;
                slotsBeforePriceCommand = List.of();
                return;
            }
            connection.sendCommand(detectedCommand.name());
            Logger.debug("Opened price GUI with server-provided /" + detectedCommand.name());
        } catch (Exception e) {
            Logger.error("Failed to execute detected price command", e);
        }
    }

    /** Call this manually (keybind/command) to force an immediate sync of whatever's open right now. */
    public void runNow() {
        if ((guiReader.getCurrentScreen() == confirmedPriceScreen && priceScreenActive)
                || (priceSessionActive && guiReader.isCurrentContainerScreen())) {
            safeRunSyncPipeline();
        } else {
            openDetectedPriceGuiThenSync();
        }
    }

    /**
     * Re-applies scheduler-dependent config (updateMode/updateInterval) after an
     * in-game change, without waiting for the next reconnect. Safe to call from
     * client commands; no-op outside automatic mode.
     */
    public void onConfigurationChanged() {
        scheduler.stop();
        if (ServerIdentity.getCurrent() == null) return;
        // start() re-validates updateMode itself and no-ops for manual modes.
        scheduler.start(() -> {
            Minecraft client = Minecraft.getInstance();
            if (client != null) client.execute(this::runAutomaticTick);
        });
        Logger.info("Price Sync scheduler restarted after a configuration change.");
    }

    private boolean sameMenuAsBeforeCommand() {
        Minecraft client = Minecraft.getInstance();
        if (client.player == null || !(screenBeforePriceCommand instanceof AbstractContainerScreen<?> beforeScreen)) {
            return false;
        }
        return beforeScreen.getMenu() == client.player.containerMenu
                && beforeScreen.getMenu() == menuBeforePriceCommand;
    }

    private boolean menuContentsChangedSinceCommand() {
        Minecraft client = Minecraft.getInstance();
        if (client.player == null || !(screenBeforePriceCommand instanceof AbstractContainerScreen<?> beforeScreen)) {
            return false;
        }
        var menu = beforeScreen.getMenu();
        if (menu == null || slotsBeforePriceCommand.isEmpty()) return false;
        if (menu.slots.size() != slotsBeforePriceCommand.size()) return true;
        for (int i = 0; i < menu.slots.size(); i++) {
            ItemStack current = menu.slots.get(i).getItem();
            if (!Objects.equals(current, slotsBeforePriceCommand.get(i))) return true;
        }
        return false;
    }

    private List<ItemStack> snapshotMenuSlots(net.minecraft.world.inventory.AbstractContainerMenu menu) {
        if (menu == null || menu.slots.isEmpty()) return List.of();
        Minecraft client = Minecraft.getInstance();
        if (client.player == null) return List.of();
        int configuredLimit = configManager.get().containerSlotCount;
        List<ItemStack> snapshot = new ArrayList<>();
        int accepted = 0;
        for (var slot : menu.slots) {
            if (slot.container == client.player.getInventory()) continue;
            if (configuredLimit > 0 && accepted >= configuredLimit) break;
            accepted++;
            snapshot.add(slot.getItem().copy());
        }
        return List.copyOf(snapshot);
    }

    /**
     * Per spec's ERROR HANDLING section ("Never crash Minecraft"): this runs
     * on the client render/tick thread (from a mixin callback or tick event),
     * so any uncaught exception here would crash or freeze the game. Every
     * entry point into the pipeline goes through this wrapper instead of
     * calling runSyncPipeline() directly.
     */
    private boolean safeRunSyncPipeline() {
        try {
            return runSyncPipeline();
        } catch (Exception e) {
            Logger.error("Sync pipeline failed (swallowed to avoid crashing the game)", e);
            return false;
        }
    }

    private boolean runSyncPipeline() {
        Screen currentScreen = guiReader.getCurrentScreen();
        if (!guiReader.isCurrentContainerScreen() || !(currentScreen instanceof AbstractContainerScreen<?>)) {
            Logger.debug("No container GUI open, skipping sync pipeline.");
            return false;
        }
        if (priceScreenActive && currentScreen != confirmedPriceScreen) {
            Logger.debug("Open screen is not the confirmed price GUI, skipping sync pipeline.");
            return false;
        }

        // Some servers reuse the exact same Screen/Menu instance when a command
        // refreshes or opens a price GUI. While correlating a command, do not
        // accept an unchanged pre-command container as its response. If the same
        // menu instance changed its slots, that is a legitimate response and can
        // be parsed; this closes the alternate-command race without breaking
        // servers that update an existing GUI in place.
        if (awaitingPriceScreen && currentScreen == screenBeforePriceCommand
                && sameMenuAsBeforeCommand()
                && !menuContentsChangedSinceCommand()) {
            Logger.debug("Ignoring unchanged pre-command container while correlating price GUI.");
            return false;
        }

        String serverIdentity = ServerIdentity.getCurrent();
        if (serverIdentity == null) {
            Logger.debug("No multiplayer server identity available, skipping sync pipeline.");
            return false;
        }
        if (detectedCommand == null || !serverIdentity.equals(activePriceServer)) {
            detectedCommand = selectPriceCommand(serverIdentity);
            activePriceServer = serverIdentity;
        }
        if (detectedCommand == null) {
            Logger.debug("No known or learned price command available on this server, skipping sync.");
            return false;
        }

        // Take exactly one GUI view snapshot for this pipeline pass. Title and
        // menu slots come from the same screen observation, so parsing,
        // fingerprinting, and pagination cannot describe different GUI states.
        GuiReader.ViewSnapshot viewSnapshot = guiReader.readOpenScreenViewSnapshot();
        List<com.example.pricesync.gui.GuiReader.SlotSnapshot> slotSnapshots = viewSnapshot.slots();

        // Read/accumulate rather than replacing the current page. The player may
        // browse page 1 -> page 2 -> back to categories -> another category; all
        // parsed rows stay in one session map until the server disconnects or a
        // fresh automatic command starts a new full scan.
        Map<String, PriceEntry> pageEntries = new LinkedHashMap<>();
        int ignoredNavigationItems = 0;
        for (var slotSnapshot : slotSnapshots) {
            ItemStack stack = slotSnapshot.stack();
            if (stack.isEmpty()) continue;
            GuiParser.ParsedItem parsedItem = guiParser.parse(stack);
            if (GuiParser.isNavigationOrCategory(parsedItem)) {
                ignoredNavigationItems++;
                continue;
            }
            Optional<PriceEntry> entry = priceParser.parse(parsedItem);
            entry.ifPresent(value -> {
                if (value.id != null && !value.id.isBlank()) pageEntries.put(value.id, value);
            });
        }
        List<PriceEntry> parsedEntries = new ArrayList<>(pageEntries.values());
        if (ignoredNavigationItems > 0) {
            Logger.debug("Ignored " + ignoredNavigationItems
                    + " category/navigation item(s) from this GUI view.");
        }

        String title = viewSnapshot.title();
        if (title == null) {
            Logger.debug("GUI view disappeared while capturing the sync snapshot.");
            return false;
        }
        String category = categorySignature(title);
        String fingerprint = menuFingerprint(slotSnapshots);
        int[] pageInfo = readPageInfo(title);
        int categoryMarkerCount = countCategoryMenuMarkersFromSnapshots(slotSnapshots);
        boolean hasCategoryMarkers = categoryMarkerCount > 0;
        // Explicit page numbers always win: a real price page such as WORTH (2/55)
        // must never be mistaken for a category hub just because a back/category
        // control is also present. For unlabelled views, one marker alone is not
        // enough evidence when priced products are present, because some price menus
        // expose a single back/category control. A genuine category hub normally has
        // multiple strong category controls, or no priced rows at all.
        boolean categoryHub = pageInfo[0] < 1
                && (categoryMarkerCount >= 2
                || (!lastViewHadPriceEntries && parsedEntries.isEmpty() && categoryMarkerCount > 0));
        // Reset pagination only on the actual transition back from a price page.
        // Do not use a changing menu fingerprint as the trigger: category hubs
        // often contain dynamic counters/progress text, so their fingerprint can
        // legitimately change on every poll while the player is still on the same
        // category screen. Repeated resets were clearing the proven Next-slot
        // evidence and making category detection unnecessarily noisy.
        boolean stableReturnToCategory = categoryHub
                && lastViewHadPriceEntries;
        if (stableReturnToCategory) {
            // A price page -> category hub transition must reset pagination even
            // when the server's category buttons have no known marker text. We
            // deliberately keep sessionEntries so already-read categories are
            // still accumulated and sent incrementally.
            resetPaginationForNewCategory();
        } else if (pageInfo[0] == 1 && lastCategorySignature != null
                && !Objects.equals(category, lastCategorySignature)) {
            // A page-1 fingerprint can change between polls because the menu may
            // refresh counters/progress or populate slots asynchronously. That is
            // not by itself evidence of a new category. Only a changed normalized
            // title is strong enough here; category-hub transitions are handled by
            // stableReturnToCategory above.
            resetPaginationForNewCategory();
        }
        lastCategorySignature = category;
        lastMenuFingerprint = fingerprint;
        lastViewHadPriceEntries = !parsedEntries.isEmpty();

        for (PriceEntry entry : parsedEntries) {
            sessionEntries.put(entry.id, entry);
        }
        List<PriceEntry> allParsedEntries = new ArrayList<>(sessionEntries.values());
        Logger.info("Collected " + parsedEntries.size() + " item(s) from this view; "
                + "" + allParsedEntries.size() + " total item(s) across browsed pages/categories.");

        // A successfully parsed price GUI is the only reliable proof that an
        // unknown server command is the price command. Learn it immediately;
        // backend availability must not determine whether command detection works.
        if (!allParsedEntries.isEmpty() && pendingCommandCandidate != null) {
            commandHistory.remember(serverIdentity, pendingCommandCandidate);
            detectedCommand = new DetectedCommand(pendingCommandCandidate);
            pendingCommandCandidate = null;
        }

        // A category hub is a navigation screen, not a price page. This guard is
        // important when a category button carries a preview price: without it,
        // pagination could treat that priced category control as page content and
        // potentially click another category control as if it were Next.
        if (categoryHub) {
            Logger.debug("Category hub detected; skipping pagination and network send for this view.");
            return true;
        }

        // Even a temporarily empty price page can still contain a valid Next
        // control while its item slots are being populated asynchronously. Advance
        // pagination before deciding that there is nothing to send; otherwise one
        // transient empty page can permanently stop a multi-page category.
        //
        // Recreated menu instances count as trusted once they show priced rows or
        // the category hub; anything else (the player's own chest, another
        // plugin's GUI) must never receive automatic navigation clicks.
        boolean trustedView = priceScreenActive || awaitingPriceScreen
                || !parsedEntries.isEmpty() || categoryHub;
        if (trustedView) {
            advancePricePageIfNeeded(title, parsedEntries, slotSnapshots);
        }

        if (allParsedEntries.isEmpty()) {
            Logger.debug("No priced items parsed from GUI.");
            return false;
        }

        // The command that actually produced parseable price data is authoritative.
        // This also repairs a stale learned command when a server changes its price
        // command but still exposes a known/working command in its live tree.
        commandHistory.remember(serverIdentity, detectedCommand.name());

        // The current page has already been parsed. Pagination was advanced above
        // even when this page had no parsed products, so a transient empty render
        // cannot strand the scan. Each page is still diffed independently; newly
        // discovered items on later pages are therefore sent even when page 1 was
        // already cached.

        // Only diff/send the page that was just read.  Diffing the entire
        // accumulated session here caused every later page/category to resend
        // all previously discovered items until the backend accepted the older
        // payload.  That can multiply Firebase writes dramatically while the
        // player is paging through a large price GUI.  sessionEntries remains
        // the in-memory aggregate for navigation/state; the network payload is
        // intentionally incremental.
        List<PriceEntry> changed = cacheManager.diff(serverIdentity, parsedEntries);
        if (changed.isEmpty()) {
            Logger.debug("No price changes detected on this GUI page, skipping API send.");
            return true;
        }

        List<PriceEntry> pagePayload = new ArrayList<>(changed);
        String json = jsonBuilder.build(serverIdentity, detectedCommand.name(), pagePayload);
        apiClient.sendPricesAsync(json);
        return true;
    }

    /** Commits cache state only after the backend has returned HTTP 2xx. */
    private void onPayloadAccepted(String json) {
        try {
            JsonBuilder.ParsedPayload accepted = jsonBuilder.parseAcceptedPayload(json);
            // The HTTP success callback may arrive after the player has switched
            // servers. The accepted payload itself is authoritative for which
            // cache partition to update; CacheManager also rejects stale timestamps.
            cacheManager.update(accepted.server(), accepted.entries(), accepted.timestamp());
            lastSyncEpochMs = System.currentTimeMillis();
            lastSyncedCount = accepted.entries().size();
            Logger.info("Synced " + accepted.entries().size() + " changed price(s).");
        } catch (Exception e) {
            // The backend already accepted the data. Do not resend it just because
            // local cache bookkeeping failed; log loudly so the next GUI poll can
            // reconcile the cache.
            Logger.error("Backend accepted payload, but local cache commit failed.", e);
        }
    }

    public String getDetectedCommand() {
        return detectedCommand == null ? null : detectedCommand.name();
    }

    /** @return epoch millis of the last successful sync, or 0 if none yet this session. */
    public long getLastSyncEpochMs() {
        return lastSyncEpochMs;
    }

    /** @return number of items sent in the last sync. */
    public int getLastSyncedCount() {
        return lastSyncedCount;
    }
}
