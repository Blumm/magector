# Verify Magector against a Magento installation

Ground truth comes from Magento / PHP itself; `compare.mjs` checks Magector against it. Use it after
changing the DI / event / PHP readers, or to see how Magector does on a given project.

| Check | Ground truth | Compared with |
|---|---|---|
| `php` | PHP's tokenizer (`php-truth.php`): classes / interfaces / enums per file, methods with visibility, static, final | `src/di-config.js` (`parsePhpTypes`, `parsePhpMembers`) |
| `xml` | DOMDocument / libxml (`xml-truth.php`): plugins, preferences, object arguments, observers per file; files Magento rejects, with its message | `src/di-config.js` (`parseDiXml`, `parseEventsXml`) |
| `plugins` | the running installation (`runtime-plugins.php`): plugins Magento runs per class and area (`PluginListInterface::getNext()`) | `magento_find_plugin` over MCP (structural part, no index needed) |

## Run

The PHP scripts need PHP 8.1+ (the Magento container: Warden `warden shell`, DDEV `ddev ssh`, …).
Paths in the file lists are relative to the Magento root.

```bash
# in the Magento root, inside the PHP container
find app/code vendor -name '*.php' -not -path '*/Test/*' -not -path '*/tests/*' | shuf -n 20000 > files.txt
find app/code vendor -path '*/etc/*' \( -name di.xml -o -name events.xml \) > xml-files.txt
printf '%s\n' 'Magento\Quote\Model\QuoteRepository' 'Magento\Customer\Model\ResourceModel\CustomerRepository' > classes.txt

php /path/to/magector/scripts/verify-magento/php-truth.php . < files.txt > php-truth.json
php /path/to/magector/scripts/verify-magento/xml-truth.php . < xml-files.txt > xml-truth.json
php /path/to/magector/scripts/verify-magento/runtime-plugins.php global,graphql,adminhtml < classes.txt > runtime-plugins.json

# anywhere with Node 18+ and the Magento files
node scripts/verify-magento/compare.mjs php     /path/to/magento php-truth.json
node scripts/verify-magento/compare.mjs xml     /path/to/magento xml-truth.json
node scripts/verify-magento/compare.mjs plugins /path/to/magento runtime-plugins.json graphql
```

`compare.mjs` prints the differences and exits with 1 when there are any. For `plugins` it reports
recall (plugins Magento runs that Magector lists) and plugins reported as running that do not run.
Pick classes the project plugs into — those are the ones a change-impact search depends on.

Example (Mage-OS 2.4.9 project, ~190 custom modules): php 0 differences on 18,419 classes; xml 0
differences on 999 files; plugins 37/37 (global) and 40/40 (graphql) on 18 classes, 0 reported as
running that do not (2.17.0: 25/37 and 3).
