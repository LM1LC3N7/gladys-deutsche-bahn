// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. No version is
// pinned: only its shape and its agreement across files.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  ACTIONS,
  LANGUAGES,
  LOOKAHEAD_MINUTES,
  MAX_STATIONS,
  POLL_MINUTES,
  THRESHOLD_MINUTES,
  WIDGETS,
} from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { ALL_TEXTS } from '../src/i18n.js';

const CORE = '/home/claude/code/Gladys/server';
const normalizeSupportedOptions = existsSync(`${CORE}/utils/normalizeSupportedOptions.js`)
  ? createRequire(import.meta.url)(`${CORE}/utils/normalizeSupportedOptions.js`)
      .normalizeSupportedOptions
  : undefined;
// The units the core accepts per category (its constants when the clone is
// here, the ones this integration uses otherwise).
const UNITS = existsSync(`${CORE}/utils/constants.js`)
  ? createRequire(import.meta.url)(`${CORE}/utils/constants.js`).DEVICE_FEATURE_UNITS_BY_CATEGORY
  : { duration: ['minutes'] };
const coreIcons = existsSync(`${CORE}/config/icons.json`)
  ? JSON.parse(readFileSync(`${CORE}/config/icons.json`, 'utf8'))
  : undefined;

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const field = (key) => manifest.config_schema.find((f) => f.key === key);

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics, the version agreeing everywhere, never pinned', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(
    manifest.gladys_version,
    '>=5.3.0',
    'widgets need 5.1.0, the catalog countries 5.3.0',
  );
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.name, 'gladys-deutsche-bahn');
  assert.equal(lock.name, pkg.name);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-deutsche-bahn:${manifest.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/LM1LC3N7\/gladys-deutsche-bahn\//,
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['transport']);
  assert.equal(manifest.keywords, undefined);
  assert.deepEqual(manifest.countries, ['DE'], 'German railways only');
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300);
    assert.match(
      docs,
      /never tested[\s>]+with[\s>]+real[\s>]+DB|jamais[\s>]+été[\s>]+testée[\s>]+avec[\s>]+de[\s>]+vrais/i,
    );
    assert.match(docs, /CC BY 4\.0/);
  }
});

test('every text is in English and French; sections within their limits', () => {
  for (const [path, entry] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(entry[lang]?.trim(), `${path} needs ${lang}`);
  }
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr'])
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
    assert.equal(section.default, undefined);
    assert.equal(section.required, undefined);
  }
});

test('no key starts with gladys_; secrets have no default; nothing said encrypted', () => {
  const all = [
    ...manifest.config_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
    ...manifest.widgets.flatMap((w) => w.settings ?? []),
  ];
  for (const f of all) assert.doesNotMatch(f.key, /^gladys_/);
  const secrets = manifest.config_schema.filter((f) => f.type === 'secret');
  assert.deepEqual(
    secrets.map((f) => f.key),
    ['client_id', 'api_key'],
  );
  for (const f of secrets) {
    assert.equal(f.default, undefined);
    assert.match(
      f.description.en,
      /Kept by Gladys in its database, never shown again, sent only to the DB API Marketplace/,
    );
    assert.match(f.description.fr, /Gard(é|ée) par Gladys dans sa base, jamais réaffiché/);
  }
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'src/i18n.js',
  ]) {
    assert.doesNotMatch(read(file), /chiffr|encrypt|hachage/i, file);
  }
});

test('the config fields are the ones the code reads, with the code defaults', () => {
  assert.equal(field('poll_minutes').default, POLL_MINUTES.default);
  assert.equal(field('poll_minutes').min, POLL_MINUTES.min);
  assert.equal(field('poll_minutes').max, POLL_MINUTES.max);
  assert.equal(field('lookahead_minutes').default, LOOKAHEAD_MINUTES.default);
  assert.equal(field('lookahead_minutes').max, LOOKAHEAD_MINUTES.max);
  assert.equal(field('delay_threshold').default, THRESHOLD_MINUTES.default);
  assert.deepEqual(
    field('language').options.map((o) => o.value),
    [...LANGUAGES],
  );
  for (let n = 1; n <= MAX_STATIONS; n += 1) {
    for (const key of [`station_${n}`, `lines_${n}`, `via_${n}`])
      assert.equal(field(key)?.type, 'string', key);
  }
  assert.equal(field(`station_${MAX_STATIONS + 1}`), undefined);
  const config = read('src/config.js');
  for (const f of manifest.config_schema.filter((x) => x.type !== 'section')) {
    const base = f.key.replace(/_\d$/, '_');
    assert.ok(
      config.includes(`'${f.key}'`) || config.includes(`.${f.key}`) || config.includes(`\`${base}`),
      f.key,
    );
  }
});

test('the actions and the widget are the ones the code handles', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS))
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  for (const a of manifest.actions) assert.ok(a.timeout_seconds >= 5 && a.timeout_seconds <= 120);
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    Object.values(WIDGETS),
  );
  assert.ok(handlers.includes('onWidgetGet(WIDGETS.DEPARTURES'));
  const [widget] = manifest.widgets;
  assert.equal(widget.settings[0].source, 'devices');
  if (coreIcons) assert.ok(JSON.stringify(coreIcons).includes(`"${widget.icon}"`), widget.icon);
  // Read-only: no command handler at all.
  assert.ok(!handlers.includes('onSetValue'));
});

test('the device: units of the core only, every feature read-only, no switch', () => {
  const gladys = createFakeGladys({ selector: 'deutsche-bahn' });
  const device = buildDevice(gladys, {
    slot: 1,
    eva: '8000207',
    name: 'Köln Hbf',
    lines: ['RE5'],
    via: '',
  });
  assert.equal(device.name, 'DB Köln Hbf (RE5)');
  for (const f of device.features) {
    assert.equal(f.read_only, true);
    assert.notEqual(f.category, 'switch');
    assert.ok(!/binary/.test(f.type));
    if (f.unit) assert.ok(UNITS[f.category].includes(f.unit), f.external_id);
    for (const option of f.supported_options ?? []) {
      assert.equal(typeof option.label, 'string');
    }
  }
});

test('supported_options of every published feature follow the core rules (none here)', () => {
  const gladys = createFakeGladys({ selector: 'deutsche-bahn' });
  const device = buildDevice(gladys, { slot: 2, eva: '8000105', name: 'X', lines: [], via: '' });
  for (const f of device.features) {
    const options = f.supported_options ?? [];
    for (const o of options) {
      assert.equal(typeof o.label, 'string');
      assert.ok(o.label.trim() === o.label && o.label.length > 0);
      assert.deepEqual(Object.keys(o).sort(), ['label', 'value']);
    }
    assert.equal(new Set(options.map((o) => o.value)).size, options.length);
    if (normalizeSupportedOptions && options.length) {
      assert.deepEqual(normalizeSupportedOptions(options), options);
    }
  }
});

test('every runtime text exists in both languages', () => {
  for (const [key, entry] of Object.entries(ALL_TEXTS)) {
    assert.deepEqual(Object.keys(entry).sort(), ['en', 'fr'], key);
    for (const lang of ['en', 'fr']) assert.ok(entry[lang].trim(), `${key}.${lang}`);
    // The same placeholders in both languages.
    const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(names(entry.fr), names(entry.en), key);
  }
});
