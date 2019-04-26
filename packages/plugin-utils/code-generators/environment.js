const Handlebars = require('handlebars');
const { declareInjections } = require('@cardstack/di');

const template = Handlebars.compile(`
define("@cardstack/plugin-utils/environment", ["exports"], function (exports) {
  "use strict";
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  {{#each properties as |property|}}
    exports.{{property.name}} = "{{property.value}}";
  {{/each}}
});
`);

module.exports = declareInjections({
  publicURL: 'config:public-url'
},

class {
  async generateCode(appModulePrefix) {
    let env = Object.assign(this._content(), { appModulePrefix });
    return template({ properties: Object.entries(env).map(([name, value]) => ({ name, value })) });
  }
  _content() {
    return {
      hubURL: this.publicURL.url,
      compiledAt: new Date().toISOString()
    };
  }
});
