<?php
namespace Acme\Disp\Service;

/** E9: a constant built from constants */
class ConstChain
{
    const A = 'acme';
    const B = self::A . '_chain';
    const C = self::B . '_end';

    public $eventManager;

    public function run()
    {
        $this->eventManager->dispatch(self::C);
    }
}
