<?php
/**
 * Ground truth for compare.mjs dispatch: PHP's values for what Magector resolved a dispatch site from.
 *
 * Input (stdin): the claims of `compare.mjs dispatch-claims` — per class that runs a site, the property,
 * constant or di.xml argument its event name was built from. For each, PHP is asked:
 *   property  — ReflectionClass(class)->getDefaultProperties()[name] (PHP resolves parents and traits)
 *   constant  — ReflectionClassConstant(class, name)->getValue() (parents and interfaces)
 *   argument  — ObjectManager\Config\Config::getArguments(type) per area, with Magento's own merge:
 *               primary + global (+ the area) read by ObjectManager\Config\Reader\Dom, argument
 *               inheritance from parents / interfaces / the virtual type's type
 * A class PHP cannot load (a missing dependency) is reported as such.
 *
 * Usage (in the Magento root, inside the PHP container):
 *   php dispatch-truth.php < dispatch-claims.json > dispatch-truth.json
 */
declare(strict_types=1);

use Magento\Framework\App\Bootstrap;
use Magento\Framework\ObjectManager\Config\Config as DiConfig;
use Magento\Framework\ObjectManager\Config\Reader\Dom as DiReader;
use Magento\Framework\ObjectManager\Definition\Runtime as RuntimeDefinition;
use Magento\Framework\ObjectManager\Relations\Runtime as RuntimeRelations;

require getcwd() . '/app/bootstrap.php';
$om = Bootstrap::create(BP, $_SERVER)->getObjectManager();
$claims = json_decode((string) stream_get_contents(STDIN), true);

$reader = $om->create(DiReader::class);
$diConfigs = [];
$diFor = static function (string $area) use (&$diConfigs, $reader): DiConfig {
    if (!isset($diConfigs[$area])) {
        $config = new DiConfig(new RuntimeRelations(), new RuntimeDefinition());
        $config->extend($reader->read('primary'));
        $config->extend($reader->read('global'));
        if ($area !== 'global') {
            $config->extend($reader->read($area));
        }
        $diConfigs[$area] = $config;
    }
    return $diConfigs[$area];
};
$argValue = static function ($arg) {
    if (!is_array($arg)) {
        return $arg;
    }
    return $arg['value'] ?? $arg['_value_'] ?? $arg['argument'] ?? json_encode($arg);
};

$out = [];
foreach ($claims['claims'] ?? [] as $i => $claim) {
    $result = ['i' => $i, 'value' => null, 'error' => null];
    try {
        switch ($claim['kind']) {
            case 'prop':
                $class = new ReflectionClass($claim['class']);
                $defaults = $class->getDefaultProperties();
                $result['value'] = array_key_exists($claim['name'], $defaults) ? $defaults[$claim['name']] : '(not declared)';
                break;
            case 'const':
                [$owner, $name] = explode('::', $claim['name']);
                $result['value'] = (new ReflectionClassConstant($claim['class'] ?: $owner, $name))->getValue();
                break;
            case 'di':
                $args = $diFor($claim['area'])->getArguments($claim['class']);
                $result['value'] = array_key_exists($claim['argument'], $args ?? []) ? $argValue($args[$claim['argument']]) : '(no argument)';
                break;
        }
    } catch (\Throwable $e) {
        $result['error'] = get_class($e) . ': ' . explode("\n", $e->getMessage())[0];
    }
    $out[] = $result;
}
echo json_encode(['php' => PHP_VERSION, 'claims' => $claims['claims'] ?? [], 'truth' => $out], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
