<?php
/**
 * Ground truth for tests/dispatch-resolution.test.js: what PHP itself dispatches. Every case of the
 * fixture's cases.json is run — the class is instantiated (with the constructor arguments di.xml would
 * give, or without its constructor), a recording event manager is put into its property, the method is
 * called — and the event names it dispatches are written down. So the expected names of the
 * inheritance cases (traits, self:: / static::, interface constants, a prefix four levels below the
 * dispatch) come from PHP's own resolution, not from the test's author.
 *
 * Usage (any PHP 8.1+, no Magento needed):
 *   php dispatch-fixture-truth.php tests/fixtures/dispatch-resolution > tests/fixtures/dispatch-resolution/truth.json
 */
declare(strict_types=1);

$fixture = rtrim($argv[1] ?? '', '/');
if (!is_dir($fixture)) {
    fwrite(STDERR, "usage: php dispatch-fixture-truth.php <fixture-root>\n");
    exit(2);
}
spl_autoload_register(static function (string $class) use ($fixture): void {
    $file = $fixture . '/app/code/' . str_replace('\\', '/', $class) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

$recorder = new class {
    public array $names = [];

    public function dispatch($name, array $data = []): void
    {
        $this->names[] = strtolower((string) $name);       // Magento's Event\Manager lower-cases the name
    }
};
$request = static fn(string $action) => new class($action) {
    public function __construct(private string $action)
    {
    }

    public function getFullActionName(): string
    {
        return $this->action;
    }
};

$out = [];
foreach (json_decode((string) file_get_contents($fixture . '/cases.json'), true) as $case) {
    $recorder->names = [];
    $class = new ReflectionClass($case['class']);
    $object = isset($case['ctor']) ? $class->newInstanceArgs($case['ctor']) : $class->newInstanceWithoutConstructor();
    $property = null;
    for ($c = $class; $c && !$property; $c = $c->getParentClass()) {
        $property = $c->hasProperty($case['em']) ? $c->getProperty($case['em']) : null;
    }
    $property->setAccessible(true);
    $property->setValue($object, $recorder);
    if (isset($case['before'])) {
        $object->{$case['before']}();
    }
    $args = array_map(static fn($a) => is_string($a) && str_starts_with($a, '@request:') ? $request(substr($a, 9)) : $a, $case['args'] ?? []);
    $method = new ReflectionMethod($object, $case['method']);
    $method->setAccessible(true);
    $method->invokeArgs($object, $args);
    $out[$case['id']] = $recorder->names;
}
echo json_encode(['php' => PHP_VERSION, 'cases' => $out], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
