<?php
namespace Acme\Disp\Service;

/** E19: a local variable assigned in two branches */
class Branchy
{
    public $eventManager;

    public function run($flag)
    {
        if ($flag) {
            $n = 'acme_branch_a';
        } else {
            $n = 'acme_branch_b';
        }
        $this->eventManager->dispatch($n);
    }
}
