<?php
namespace Acme\Live;

/**
 * F2: a stale copy of the same class beside the live package (like vendor/magento/framework next to
 * vendor/mage-os/framework after a switch to Mage-OS) — composer never loads this file.
 */
class Model
{
    protected $_eventPrefix = 'acme_live';

    protected $_eventManager;

    public function save()
    {
        $this->_eventManager->dispatch('acme_live_ping');
        $this->_eventManager->dispatch($this->_eventPrefix . '_saved');
    }
}
