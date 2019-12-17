import { Indexer, IndexingOperations } from '../indexer';
import { inject } from '../dependency-injection';
import { CardWithId } from '../card';

interface EphemeralMeta {
  identity: number;
  generation?: number;
}

export default class EphemeralIndexer implements Indexer<EphemeralMeta> {
  ephemeralStorage = inject('ephemeralStorage');

  constructor(private realmCard: CardWithId) {}

  async update(meta: EphemeralMeta, ops: IndexingOperations) {
    let { identity, generation } = meta || {};
    let newGeneration = this.ephemeralStorage.currentGeneration;

    if (identity !== this.ephemeralStorage.identity) {
      generation = undefined;
      await ops.beginReplaceAll();
    }

    let entries = this.ephemeralStorage.entriesNewerThan(this.realmCard.localId, generation);
    for (let entry of entries) {
      if (entry.doc) {
        await ops.save(entry.doc);
      } else {
        await ops.delete(entry.id);
      }
    }

    if (identity !== this.ephemeralStorage.identity) {
      await ops.finishReplaceAll();
    }

    return {
      identity: this.ephemeralStorage.identity,
      generation: newGeneration,
    };
  }
}
