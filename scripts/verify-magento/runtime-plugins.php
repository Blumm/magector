<?php
/**
 * Ground truth for Magector's plugin answers: the plugins Magento actually runs for each class, per
 * area, read from the running installation (PluginListInterface::getNext() — disabled plugins,
 * inheritance from parents / interfaces, virtual types and module order already applied).
 *
 *   php runtime-plugins.php [area,area,…] < classes.txt > runtime-plugins.json
 *
 * Run from the Magento root. classes.txt: one FQCN per line. Output: { area: { class: [plugin names] } }.
 */
declare(strict_types=1);

use Magento\Framework\App\Bootstrap;

require getcwd() . '/app/bootstrap.php';

$areas = explode(',', $argv[1] ?? 'global');
$classes = array_values(array_filter(array_map('trim', explode("\n", (string)stream_get_contents(STDIN)))));
$out = [];
foreach ($areas as $area) {
    $om = Bootstrap::create(BP, $_SERVER)->getObjectManager();
    if ($area !== 'global') {
        $om->get(\Magento\Framework\App\State::class)->setAreaCode($area);
        $om->configure($om->get(\Magento\Framework\ObjectManager\ConfigLoaderInterface::class)->load($area));
    }
    $om->get(\Magento\Framework\Config\ScopeInterface::class)->setCurrentScope($area);
    $config = $om->get(\Magento\Framework\ObjectManager\ConfigInterface::class);
    $pluginList = $om->get(\Magento\Framework\Interception\PluginListInterface::class);
    foreach ($classes as $class) {
        // The interceptor looks plugins up by the real class of the instance
        $type = preg_replace('/\\\\Interceptor$/', '', $config->getInstanceType($config->getPreference(ltrim($class, '\\'))));
        $names = [];
        $walk = function (?string $code) use (&$walk, &$names, $pluginList, $type, $class): void {
            foreach (get_class_methods($type) ?: [] as $method) {
                $next = $code === null ? $pluginList->getNext($type, $method) : $pluginList->getNext($type, $method, $code);
                if (!$next) {
                    continue;
                }
                foreach ((array)($next[1] ?? []) as $c) { $names[$c] = true; }
                foreach ((array)($next[4] ?? []) as $c) { $names[$c] = true; }
                if (isset($next[2]) && !isset($names[$next[2]])) {
                    $names[$next[2]] = true;
                    $walk($next[2]);
                }
            }
        };
        try {
            $walk(null);
        } catch (\Throwable $e) {
            $names = ['__error__: ' . $e->getMessage() => true];
        }
        $out[$area][$class] = array_keys($names);
    }
}
echo json_encode($out, JSON_UNESCAPED_SLASHES);
