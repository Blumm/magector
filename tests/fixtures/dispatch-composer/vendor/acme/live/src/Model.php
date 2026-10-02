<?php
namespace Acme\Live;

/** F2: the file composer loads for Acme\Live\Model (autoload_psr4.php) */
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
