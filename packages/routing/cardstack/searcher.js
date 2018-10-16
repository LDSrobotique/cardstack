const { declareInjections } = require('@cardstack/di');

module.exports = declareInjections({
  searchers: 'hub:searchers',
  schema: 'hub:current-schema',
},

class RoutingSearcher {
  static create(...args) {
    return new this(...args);
  }
  constructor({ dataSource, searchers, schema}) {
    this.dataSource = dataSource;
    this.searchers = searchers;
    this.schema = schema;
  }

  async get(session, branch, type, id, next) {
    if (type === 'spaces') {
      return await this._getSpace(session, branch, id);
    }
    return next();
  }

  async search(session, branch, query, next) {
    return next();
  }

  // The initial pass of retreiving a space is to fashion a relationship
  // to a content type based on the id of the space
  async _getSpace(session, branch, id) {
    let [ cardType, cardId ] = id.split('/');
    if (!cardType || !cardId) {
      throw new Error(`The requested space '${id}' is not valid. A card type and card ID must be supplied`, { status: 400 });
    }

    let schema =  await this.schema.forBranch(branch);
    let contentType = schema.types.get(cardType);
    let card;
    if (this.cardType !== 'spaces'){
      if (contentType && contentType.routingField) {
        let { data:docs } = await this.searchers.search(session, branch, {
          filter: {
            type: cardType,
            [contentType.routingField]: { exact: cardId }
          }
        });
        if (docs && docs.length) {
          card = docs[0];
        }
      } else {
        let { data:doc } = await this.searchers.get(session, branch, cardType, cardId);
        card = doc;
      }
    }

    if (!card) {
      throw new Error(`The primary card '${cardType}/${cardId}' for the requested space '${id}' does not exist`, { status: 404 });
    }

    return {
      data: {
        id,
        type: 'spaces',
        attributes: { 'url-segment': `/${cardType}/${cardId}` },
        relationships: {
          'primary-card': {
            data: { type: card.type, id: card.id }
          }
        }
      }
    };
  }

});