<?php
namespace Acme\Disp\Service;

/**
 * F11: a required constructor argument di.xml does not set replaces the declared default — the name is
 * known only at runtime, and the default never reaches the dispatch
 */
class Wired
{
    public $eventManager;

    protected $eventPrefix = 'acme';

    public function __construct($eventPrefix)
    {
        $this->eventPrefix = $eventPrefix;
    }

    public function run()
    {
        $this->eventManager->dispatch($this->eventPrefix . '_wired_ran');
    }
}
