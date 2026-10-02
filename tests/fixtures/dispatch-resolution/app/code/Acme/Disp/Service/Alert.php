<?php
namespace Acme\Disp\Service;

/** E8/E11: an interface constant through a local variable; a runtime part stays a wildcard */
class Alert implements AlertInterface
{
    public $eventManager;

    public function event($module)
    {
        $generic = AlertInterface::EVENT_PREFIX . '_event';
        $moduleEvent = AlertInterface::EVENT_PREFIX . '_event_' . strtolower($module);
        $this->eventManager->dispatch($generic);
        $this->eventManager->dispatch($moduleEvent);
        $this->eventManager->dispatch(self::ROOT . '_reached');
    }
}
