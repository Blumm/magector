<?php
namespace Acme\Disp\Emitter;

/** E5: the dispatch reads a property this class does not declare — a trait of the subclass does */
class Emitter
{
    public $eventManager;

    public function emit()
    {
        $this->eventManager->dispatch($this->eventPrefix . '_emitted');
    }
}
