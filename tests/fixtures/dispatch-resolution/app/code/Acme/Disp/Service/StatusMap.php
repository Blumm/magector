<?php
namespace Acme\Disp\Service;

/** E10: a value of a constant map */
class StatusMap
{
    const MAP = ['a' => 'acme_status_approved', 'r' => 'acme_status_rejected'];

    public $eventManager;

    public function run($code)
    {
        $name = self::MAP[$code] ?? null;
        if ($name) {
            $this->eventManager->dispatch($name);
        }
    }
}
