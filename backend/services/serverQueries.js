const { getServerAliases } = require('./serverIdentity');

const FIRESTORE_IN_LIMIT = 30;

function chunk(values, size = FIRESTORE_IN_LIMIT) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

async function queryByServer(collection, server, buildQuery) {
  const aliases = Array.from(new Set(await getServerAliases(server)));
  if (aliases.length === 0) return [];

  const chunks = chunk(aliases);
  const snapshots = await Promise.all(
    chunks.map((values) => {
      const query = values.length === 1
        ? collection.where('server', '==', values[0])
        : collection.where('server', 'in', values);
      return buildQuery(query).get();
    })
  );

  return snapshots.flatMap((snapshot) => snapshot.docs);
}

module.exports = { FIRESTORE_IN_LIMIT, chunk, queryByServer };
