/* eslint-env node */

const JSONAPIFactory = require('@cardstack/test-support/jsonapi-factory');
const qs = require('qs');

function addConstraint(factory, constraint, field) {
  factory.addResource('constraints')
    .withAttributes({
      constraintType: constraint,
      inputs: { ignoreBlank: true }
    })
    .withRelated('input-assignments', [
      factory.addResource('input-assignments')
        .withAttributes({ inputName: 'target' })
        .withRelated('field', factory.getResource('fields', field)),
    ]);
}

function initialModels() {
  let initial = new JSONAPIFactory();

  initial.addResource('grants')
    .withRelated('who', [{ type: 'groups', id: 'everyone' }])
    .withAttributes({
      'may-read-resource': true,
      'may-read-fields': true,
      'may-login': true
    });

  initial.addResource('grants')
    .withRelated('who', [{ type: 'groups', id: 'everyone' }])
    .withRelated('types', [
      { type: 'content-types', id: 'categories' },
      { type: 'content-types', id: 'bloggers' },
      { type: 'content-types', id: 'comments' },
      { type: 'content-types', id: 'karma-types' },
      { type: 'content-types', id: 'posts' },
      { type: 'content-types', id: 'time-units' },
      { type: 'content-types', id: 'created-at' },
      { type: 'content-types', id: 'keywords' },
      { type: 'content-types', id: 'rating' }
    ])
    .withAttributes({
      'may-create-resource': true,
      'may-update-resource': true,
      'may-delete-resource': true,
      'may-write-fields': true
    });


  initial.addResource('content-types', 'categories')
    .withRelated('fields', [
      initial.addResource('fields', 'name').withAttributes({
        fieldType: '@cardstack/core-types::string'
      }),
      initial.addResource('fields', 'popularity').withAttributes({
        fieldType: '@cardstack/core-types::integer'
      }),
    ]);

  initial.addResource('content-types', 'bloggers')
    .withRelated('fields', [
      initial.addResource('fields', 'name').withAttributes({
        fieldType: '@cardstack/core-types::string'
      }),
    ]);

  initial.addResource('content-types', 'comments')
    .withAttributes({
      fieldsets: {
        embedded: [
          { field: 'poster', format: 'embedded' },
          { field: 'karma-type', format: 'embedded' },
        ]
      }
    })
    .withRelated('fields', [
      initial.addResource('fields', 'body').withAttributes({
        fieldType: '@cardstack/core-types::string'
      }),
      initial.addResource('fields', 'poster').withAttributes({
        fieldType: '@cardstack/core-types::belongs-to',
      }).withRelated('related-types', [
        initial.getResource('content-types', 'bloggers')
      ]),
      initial.addResource('fields', 'karma-value').withAttributes({
        caption: 'Value',
        fieldType: '@cardstack/core-types::integer'
      }),
      initial.addResource('fields', 'karma-type').withAttributes({
        caption: 'Type',
        fieldType: '@cardstack/core-types::belongs-to',
        editorComponent: 'field-editors/dropdown-choices-editor'
      }).withRelated('related-types', [
        initial.addResource('content-types', 'karma-types')
          .withRelated('fields', [
            initial.addResource('fields', 'title')
              .withAttributes({ fieldType: '@cardstack/core-types::string' })
          ])
        ]),
      initial.addResource('fields', 'review-status').withAttributes({
        fieldType: '@cardstack/core-types::string',
      }),
    ]);

  initial.addResource('content-types', 'posts')
    .withAttributes({
      fieldsets: {
        isolated: [
          { field: 'author', format: 'embedded' },
          { field: 'categories', format: 'embedded' },
          { field: 'reading-time-unit', format: 'embedded' },
          { field: 'comments', format: 'embedded' },
          { field: 'comments.poster', format: 'embedded' },
          { field: 'comments.karma-type', format: 'embedded' },
        ]
      }
    })
    .withRelated('fields', [
      initial.addResource('fields', 'title').withAttributes({
        fieldType: '@cardstack/core-types::string'
      }),
      initial.addResource('fields', 'keywords').withAttributes({
        editorOptions: { headerSection: true, sortOrder: 10 },
        fieldType: '@cardstack/core-types::string'
      }),
      initial.addResource('fields', 'rating').withAttributes({
        editorOptions: { headerSection: true, sortOrder: 20, hideTitle: true },
        fieldType: '@cardstack/core-types::integer'
      }),
      initial.addResource('fields', 'created-at').withAttributes({
        editorOptions: { headerSection: true, sortOrder: 101 },
        fieldType: '@cardstack/core-types::date'
      }),
      initial.addResource('fields', 'published-at').withAttributes({
        caption: 'Publish Date',
        fieldType: '@cardstack/core-types::date'
      }),
      initial.addResource('fields', 'reading-time-value').withAttributes({
        caption: 'Value',
        fieldType: '@cardstack/core-types::integer'
      }),
      initial.addResource('fields', 'reading-time-unit').withAttributes({
        caption: 'Unit',
        fieldType: '@cardstack/core-types::belongs-to',
        editorComponent: 'field-editors/dropdown-choices-editor'
      }).withRelated('related-types', [
        initial.addResource('content-types', 'time-units')
          .withRelated('fields', [
            initial.addResource('fields', 'title')
              .withAttributes({ fieldType: '@cardstack/core-types::string' })
          ])
        ]),
      initial.addResource('fields', 'archived').withAttributes({
        fieldType: '@cardstack/core-types::boolean'
      }),
      initial.addResource('fields', 'slug').withAttributes({
        fieldType: '@cardstack/core-types::string'
      }),
      initial.addResource('fields', 'categories').withAttributes({
        fieldType: '@cardstack/core-types::has-many',
        editorComponent: 'field-editors/category-editor',
        owned: true
      }).withRelated('related-types', [
        initial.getResource('content-types', 'categories')
      ]),
      initial.addResource('fields', 'comments').withAttributes({
        fieldType: '@cardstack/core-types::has-many',
        owned: true,
      }).withRelated('related-types', [
        initial.getResource('content-types', 'comments')
      ]),
      initial.addResource('fields', 'author').withAttributes({
        fieldType: '@cardstack/core-types::belongs-to',
      }).withRelated('related-types', [
        initial.getResource('content-types', 'bloggers')
      ]),
      initial.addResource('computed-fields', 'author-name').withAttributes({
        computedFieldType: '@cardstack/core-types::alias',
        params: {
          aliasPath: 'author.name',
        }
      }),
      initial.addResource('fields', 'hidden-field-from-editor').withAttributes({
        fieldType: '@cardstack/core-types::string',
        editorOptions: { hideFromEditor: true }
      }),
      initial.addResource('computed-fields', 'hidden-computed-field-from-editor').withAttributes({
        computedFieldType: '@cardstack/core-types::alias',
        editorOptions: { hideFromEditor: true },
        params: {
          aliasPath: 'author-name',
        }
      }),
    ]);

  initial.addResource('content-types', 'catalogs')
  .withAttributes({
    defaultIncludes: ['popular-posts', 'top-post'],
    fieldsets: {
      isolated: [
        { field: 'popular-posts', format: 'embedded' },
        { field: 'top-post', format: 'embedded' }
      ]
    }
  })
  .withRelated('fields', [
    initial.addResource('fields', 'title').withAttributes({
      fieldType: '@cardstack/core-types::string'
    }),
    initial.addResource('fields', 'popular-posts').withAttributes({
      fieldType: '@cardstack/core-types::has-many'
    }),
    initial.addResource('fields', 'top-post').withAttributes({
      fieldType: '@cardstack/core-types::belongs-to'
    })
  ]);

    addConstraint(initial, '@cardstack/core-types::not-empty', 'title');
    addConstraint(initial, '@cardstack/core-types::not-empty', 'body');

  let guybrush = initial.addResource('bloggers', '1')
    .withAttributes({
      name: 'Guybrush Threepwood'
    });

  let lechuck = initial.addResource('bloggers', '2')
    .withAttributes({
      name: 'LeChuck'
    });

  let adventure = initial.addResource('categories', '1')
    .withAttributes({
      name: 'Swashbuckling Adventure',
      popularity: 10,
    });

  let career = initial.addResource('categories', '2')
    .withAttributes({
      name: 'Career in Pirating',
      popularity: 3
    });

  let goodKarma = initial.addResource('karma-types', '1')
    .withAttributes({ title: 'Good' });
  let badKarma = initial.addResource('karma-types', '2')
    .withAttributes({ title: 'Bad' });
  initial.addResource('karma-types', '3')
    .withAttributes({ title: 'Neutral' });

  let threeHeadedMonkey = initial.addResource('comments', '1')
    .withAttributes({
      body: 'Look behind you, a Three-Headed Monkey!',
      karmaValue: 10,
      reviewStatus: 'approved'
    })
    .withRelated('poster', guybrush)
    .withRelated('karma-type', goodKarma);

  let diapers = initial.addResource('comments', '2')
    .withAttributes({
      body: 'Have you stopped wearing diapers yet?',
      karmaValue: 5,
      reviewStatus: 'pending'
    })
    .withRelated('poster', guybrush)
    .withRelated('karma-type', badKarma);

  let doorstop = initial.addResource('comments', '3')
    .withAttributes({
      body: 'You’re about as fearsome as a doorstop.'
    })
    .withRelated('poster', guybrush);

  let brains = initial.addResource('comments', '4')
    .withAttributes({
      body: "You're no match for my brains, you poor fool."
    })
    .withRelated('poster', guybrush);

  initial.addResource('time-units', '1')
    .withAttributes({ title: 'minutes' });
  initial.addResource('time-units', '2')
    .withAttributes({ title: 'hours' });
  initial.addResource('time-units', '3')
    .withAttributes({ title: 'days' });

  initial.addResource('posts', '1')
    .withAttributes({
      title: '10 steps to becoming a fearsome pirate',
      publishedAt: new Date(2017, 3, 24),
      createdAt: new Date(2017, 1, 24),
      keywords: 'pirates, matey, bacardi',
      rating: 2,
      archived: false,
      readingTimeValue: 8,
      hiddenFieldFromEditor: 'This field is hidden from the editor'
    })
    .withRelated('reading-time-unit', { type: 'time-units', id: '1' })
    .withRelated('author', lechuck)
    .withRelated('categories', [ adventure ])
    .withRelated('comments', [ threeHeadedMonkey, diapers ]);

  initial.addResource('posts', '2')
    .withAttributes({
      title: 'Second Post',
      publishedAt: new Date(2017, 9, 20),
      createdAt: new Date(2017, 1, 24),
      keywords: 'dos, ni, futatsu',
      rating: 4,
      archived: true,
      readingTimeValue: 2
    })
    .withRelated('reading-time-unit', { type: 'time-units', id: '2' })
    .withRelated('author', lechuck)
    .withRelated('categories', [ career ])
    .withRelated('comments', [ doorstop, brains ]);

  initial.addResource('catalogs', '1')
    .withAttributes({
      title: 'Posts Catalog'
    })
    .withRelatedLink('popular-posts', `/api?${qs.stringify({
      filter: {
        type: { exact: 'posts' },
        rating: { range: { gt: 3 } }
      },
      sort: '-rating'
    })}`)
    .withRelatedLink('top-post', `/api?${qs.stringify({
      filter: {
        type: { exact: 'posts' }
      },
      sort: '-rating',
      page: {
        size: 1
      }
    })}`);

  return initial.getModels();
}

module.exports = initialModels();

