<?php
namespace Acme\Disp\Service;

/** F6: a local variable extended with .= in a branch */
class Appended
{
    public $eventManager;

    public function run($flag)
    {
        $name = 'acme_appended';
        if ($flag) {
            $name .= '_flagged';
        }
        $this->eventManager->dispatch($name);
    }
}
