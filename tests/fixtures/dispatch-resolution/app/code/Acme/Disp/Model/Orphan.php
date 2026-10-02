<?php
namespace Acme\Disp\Model;

/** E17: the parent's file does not exist — the prefix cannot be read from it */
class Orphan extends \Acme\Missing\Base
{
    public $eventManager;

    public function run()
    {
        $this->eventManager->dispatch($this->prefix . '_orphan');
    }
}
