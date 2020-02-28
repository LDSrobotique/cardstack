import { click, find, triggerEvent, fillIn, visit, waitFor, getContext } from '@ember/test-helpers';
import { animationsSettled } from 'ember-animated/test-support';

const timeout = 5000;

export async function showCardId(toggleDetailsSection = false) {
  await click(`.card-renderer-isolated`);

  if (toggleDetailsSection) {
    await click('[data-test-right-edge-section-toggle="details"]');
  }

  await animationsSettled();
}

export async function setCardName(name) {
  await fillIn('#card__name', name);
  await click('[data-test-create-card-btn]');
}

export async function dragAndDrop(fieldSelector, dropZoneSelector, options) {
  await triggerEvent(fieldSelector, 'mousedown');
  await triggerEvent(fieldSelector, 'dragstart', options);
  await triggerEvent(dropZoneSelector, 'dragenter', options);
  await animationsSettled();
  await triggerEvent(dropZoneSelector, 'drop', options);
  await animationsSettled();
}

export async function dragAndDropNewField(type, position = 0) {
  await click(`[data-test-card-add-field-draggable="${type}"]`);
  await triggerEvent(`[data-test-drop-zone="${position}"]`, 'mouseenter');
  await click(`[data-test-drop-zone="${position}"]`);
  await animationsSettled();
}

// NOTE: Position is 0-based
export async function dragFieldToNewPosition(originalPosition, newPosition) {
  newPosition = originalPosition < newPosition ? newPosition + 1 : newPosition;
  let fieldName;
  let options = {
    dataTransfer: {
      getData: type => {
        if (type === 'text/field-name') {
          return fieldName;
        }
      },
      setData: (type, name) => (fieldName = name),
    },
  };
  await dragAndDrop(
    `[data-test-field-renderer-move-btn-position="${originalPosition}"]`,
    `[data-test-drop-zone="${newPosition}"]`,
    options
  );
}

export async function createCards(args) {
  for (let id of Object.keys(args)) {
    await visit('/cards/new');
    await setCardName(id);

    for (let [index, [name, type, neededWhenEmbedded]] of args[id].entries()) {
      await addField(name, type, neededWhenEmbedded, index);
    }
    await saveCard();

    await visit(`/cards/${id}/edit/fields`);
    for (let [name, , , value] of args[id]) {
      if (value == null) {
        continue;
      }
      await setFieldValue(name, value);
    }
    await saveCard();
    await visit(`/cards/${id}`);
    await animationsSettled();
  }
}

export async function saveCard() {
  getContext()
    .owner.lookup('service:autosave')
    ._saveOnceInTests();
  await waitFor('[data-test-card-is-dirty="no"]', { timeout });
  await animationsSettled();
}

export async function addField(name, type, isEmbedded, position) {
  await dragAndDropNewField(type, position);

  await fillIn('[data-test-schema-attr="name"] input', name);
  await triggerEvent('[data-test-schema-attr="name"] input', 'keyup');

  if (isEmbedded) {
    await click('[data-test-schema-attr="embedded"] input[type="checkbox"]');
  }

  await animationsSettled();
}

export async function setFieldValue(name, value) {
  let type = find(`[data-test-field="${name}"]`).getAttribute('data-test-field-type');
  if (type === '@cardstack/core-types::boolean') {
    if (value) {
      await click(`[data-test-field="${name}"] .cardstack-core-types-field-value-true`);
    } else {
      await click(`[data-test-field="${name}"] .cardstack-core-types-field-value-false`);
    }
  } else if (type === '@cardstack/core-types::has-many' && Array.isArray(value)) {
    await fillIn(`[data-test-edit-field="${name}"]`, value.join(','));
    await triggerEvent(`[data-test-edit-field="${name}"]`, 'keyup');
  } else {
    await fillIn(`[data-test-edit-field="${name}"]`, value);
    await triggerEvent(`[data-test-edit-field="${name}"]`, 'keyup');
  }
}

export async function removeField(name) {
  await click(`[data-test-field="${name}"] [data-test-field-renderer-remove-btn]`);
}
