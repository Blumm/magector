<?php
namespace Acme\Disp\Service;

/** F3: two dispatches on one line — two sites */
class OneLine
{
    public $eventManager;

    public function run()
    {
        $this->eventManager->dispatch('acme_line_first'); $this->eventManager->dispatch('acme_line_second');
    }
}
