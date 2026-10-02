<?php
namespace Acme\Unmapped;

/** F2: a class composer cannot resolve at all — nothing says it is not the code that runs */
class Thing
{
    public $eventManager;

    public function run()
    {
        $this->eventManager->dispatch('acme_unmapped_ping');
    }
}
