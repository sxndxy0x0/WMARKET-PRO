// Legacy deterministic Firestore doc IDs used `__` as a separator. New
// writes use collision-proof IDs when a segment contains that separator;
// this validation still rejects path/control characters that would be unsafe
// or nonsensical as IDs.
// Firestore's `.doc(id)` call treats a "/" in that string as a *path
// separator* into a subcollection, not a literal character — so an
// unsanitized itemId/server containing "/" (trivial to send: Express
// decodes a URL-encoded "%2F" route param back into a literal "/" before
// your handler ever sees it, and a JSON body field has no such encoding
// step to begin with) silently redirects the write into a different part
// of the document tree instead of the flat collection every other query
// in this codebase assumes. That can make an entry vanish from
// `watchlistCol.where('userId','==',...)` results (because it's no longer
// a direct child of `watchlist`) while still existing and consuming quota,
// and lets one authenticated user's crafted input reach doc paths well
// outside the shape this collection is supposed to have.
//
// `server` values come from this project's own fixed list of Minecraft
// server names; `itemId` values come from the mod's own item registry —
// neither legitimately needs "/" or the other Firestore-reserved forms
// below, so rejecting them is a plain validation rule, not a compatibility
// risk for real callers.
const MAX_ID_LENGTH = 200;

// Firestore doc IDs additionally may not be "." or ".." exactly, may not
// contain a NUL byte, and may not match the reserved pattern /^__.*__$/.
function isValidFirestoreIdSegment(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    !value.includes('/') &&
    !value.includes('\0') &&
    !/[\p{C}]/u.test(value) &&
    value !== '.' &&
    value !== '..' &&
    !/^__.*__$/.test(value)
  );
}

module.exports = { isValidFirestoreIdSegment, MAX_ID_LENGTH };
