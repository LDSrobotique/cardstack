import { UpstreamDocument, UpstreamIdentity } from '../document';
import { CardId } from '../card';
import { MetaObject } from 'jsonapi-typescript';
import CardstackError from '../error';

interface StoreEntry {
  id: CardId;
  doc: UpstreamDocument | null;
  generation: number;
}

export class EphemeralStorage {
  private generationCounter = 0;
  private _identity = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  private _store = new Map() as Map<string, StoreEntry>;

  get identity() {
    return this._identity;
  }

  get currentGeneration() {
    return this.generationCounter;
  }

  store(doc: UpstreamDocument | null, id: UpstreamIdentity, realm: string, ifMatch?: string | number) {
    this.generationCounter++;
    let originalRealm = typeof id === 'string' ? realm : id.originalRealm;
    let localId = typeof id === 'string' ? id : id.localId;
    let key = [realm, originalRealm, localId].map(encodeURIComponent).join('/');
    let entry = this._store.get(key);

    if (entry && ifMatch != null && String(entry.generation) !== String(ifMatch)) {
      throw new CardstackError('Merge conflict', {
        status: 409,
        source: doc ? { pointer: '/data/meta/version' } : { header: 'If-Match' },
      });
    }

    let meta: MetaObject | undefined;
    if (doc) {
      meta = Object.assign({}, doc.jsonapi.data.meta);
      meta.version = this.generationCounter;
      doc.jsonapi.data.meta = meta;
    }
    this._store.set(key, {
      id: {
        realm,
        originalRealm,
        localId,
      },
      doc,
      generation: this.generationCounter,
    });

    return doc;
  }

  entriesNewerThan(realmURL: string, generation = -Infinity): StoreEntry[] {
    return [...this._store.entries()]
      .filter(([key]) => key.indexOf(encodeURIComponent(realmURL)) === 0)
      .filter(([, entry]) => entry.generation > generation)
      .map(([, entry]) => entry);
  }

  // Supports some internal testing. Allows us to distinguish which cards are
  // being indexed incrementally vs full
  async inThePast(fn: () => Promise<void>) {
    let gen = this.generationCounter;
    try {
      this.generationCounter = -Infinity;
      await fn();
    } finally {
      this.generationCounter = gen;
    }
  }
}

declare module '@cardstack/hub/dependency-injection' {
  interface KnownServices {
    ephemeralStorage: EphemeralStorage;
  }
}
