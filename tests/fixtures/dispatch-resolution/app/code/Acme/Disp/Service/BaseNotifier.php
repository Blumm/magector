<?php
namespace Acme\Disp\Service;

/** E7: static:: is the class that runs, self:: the class that wrote it */
class BaseNotifier
{
    const KIND = 'base';

    public $eventManager;

    public function notify()
    {
        $this->eventManager->dispatch('acme_' . static::KIND . '_static');
        $this->eventManager->dispatch('acme_' . self::KIND . '_self');
    }
}
