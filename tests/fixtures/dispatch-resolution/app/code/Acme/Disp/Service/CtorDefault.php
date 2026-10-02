<?php
namespace Acme\Disp\Service;

/** F7: the prefix from a constructor parameter that di.xml does not set — PHP takes its default */
class CtorDefault
{
    public $eventManager;

    protected $eventPrefix;

    public function __construct($eventPrefix = 'acme_ctordefault')
    {
        $this->eventPrefix = $eventPrefix;
    }

    public function run()
    {
        $this->eventManager->dispatch($this->eventPrefix . '_ran');
    }
}
