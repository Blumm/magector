# DI / event resolution — open items (TODO)

Follow-ups to the structural DI / event resolution (`src/di-config.js`). Verification against a
Magento installation: `scripts/verify-magento/`.

## A. Invalid XML / values — report as an error, ideally with Magento's native message

Magento behaviour (Mage-OS 2.4.9 source):
- Not well-formed XML → `Config\Dom::_initDom()` fails in **every mode** → `LocalizedException`
  `The XML in file "<file>" is invalid:\n<errors>\nVerify the XML and try again.` — the area's configuration
  does not load. Error format `Config\Dom::ERROR_FORMAT_DEFAULT` = `"%message%\nLine: %line%\n"` (libxml messages).
- XSD validation only when validation is required (developer mode); production skips it and the
  converters decide.
- Plugin `disabled`: `BooleanUtils::toBoolean()` strict — `true`, `1`, `'true'`, `'1'` / `false`, `0`, `'false'`, `'0'`;
  anything else → `InvalidArgumentException: Boolean value is expected, supported values: array (…)` in
  every mode. `sortOrder` → `(int)` cast.
- Observer `disabled`: only `'true'` disables; anything else is silently "not disabled".

| # | Variant | Magento | Branch now | To do |
|---|---------|---------|------------|-------|
| A1 | Not well-formed (`/ >`, unclosed / mismatched tag, bare `&`, `<` in attribute, unquoted attribute, duplicate attribute, extra content after root) | error in every mode, area not loaded | tolerant parser salvages part of the data silently | report the file as broken with the native message; do not use its declarations; flag effective state as unreliable |
| A2 | Plugin `disabled=" true "`, `TRUE`, `yes` | `InvalidArgumentException`, DI config fails | accepted as true / ignored | error with the native message |
| A3 | Observer `disabled="1"`, `" true"`, `TRUE` | not disabled | not disabled (no warning) | warning |
| A4 | `sortOrder="abc"` / `"10x"` | `(int)` → 0 / 10 | kept as text | cast like PHP + warning |
| A5 | Missing required attribute (plugin / observer / type `name`, preference `for` / `type`, virtualType `name` / `type`) | XSD error in developer mode | ignored | warning ("developer mode: fails") |
| A6 | Unknown element / attribute (XSD-invalid) | XSD error in developer mode only | ignored | warning |

Implementation plan:
- **Native mode** (when `php` is available — `MAGECTOR_PHP` or PATH; Warden / DDEV PHP containers have it):
  one PHP process per session runs `DOMDocument::loadXML()` + `schemaValidate()` like `Config\Dom::_initDom()`,
  resolving `urn:magento:module:…` / `urn:magento:framework…:…` like `Config\Dom\UrnResolver` (module dirs
  from module.xml / registration, framework from the composer PSR-4 map) → exact libxml messages in
  Magento's format and wrapper text.
- **Built-in fallback** (no PHP): well-formedness checks with libxml's wording for the common cases (A1),
  value checks (A2–A4) with Magento's exact texts, required attributes (A5); schema validation (A6) only
  in native mode.
- New tool **`magento_validate_config`** — all config files that Magento would reject, by severity
  (every mode / developer mode only), like a build check; DI and event tools show errors of the files
  they read and a one-line notice when any config file in the project is broken.
- Tests: one fixture file per variant, native and fallback paths.

## B. Decision needed

| # | Question | Now | Proposal |
|---|----------|-----|----------|
| B1 | composer `require` as a dependency for the ambiguity check | counts like `<sequence>` | Magento orders modules **only** by `<sequence>`; `require` does not affect load order → report "order held only by composer require" as a weaker warning instead of hiding it |

## C. Not fixed — returns less (narrower)

| # | Item |
|---|------|
| C1 | `find_callers`: calls through factory-created instances (`$f->create()->x()`) and untyped variables |
| C2 | `trace_flow` deep for GraphQL stops at the resolver (does not follow the injected service → preference → plugins) |
| C3 | Remaining regex readers: `trace_shipping_chain`, `trace_api`, `trace_call_chain` (only comment stripping applied) |
| C4 | Generated classes (`generated/`: Factory, Proxy, Interceptor) and classes without a file → hierarchy unknown, inherited plugins can be missed, interceptability "unknown" |

## D. Not fixed — returns more / behaviour (left on purpose)

| # | Item |
|---|------|
| D1 | MCP server starts a full re-index on connect when no index exists |
| D2 | First, semantic block of `find_plugin` lists unrelated plugin classes |

## E. Known limits (documented)

- Module order without `app/etc/config.php` is approximated from `<sequence>`.
- Full plugin execution order (sortOrder chain, around nesting) is not shown — per-plugin sortOrder only;
  runtime order: `magento-di-inspect.php`.
- Observer `shared="false"`, observer `method` details not evaluated.
- First call on a large project: `find_plugin` ≈ 4 s, `find_implementors` ≈ 8 s; no cache across sessions.
- Short class names stay fuzzy (by design).

## F. Not verified

- `npm run test:accuracy` (needs an indexed Magento 2.4.7).
- Semantic search quality on a full project index.
- Tools for layout / templates / blocks, fieldset, shipping chain, diff analysis, complexity.
- Upstream: 4 failing `unit.test.js` cases (`ast_search`, `find_dataobject_issues`) — also on 2.17.0.
