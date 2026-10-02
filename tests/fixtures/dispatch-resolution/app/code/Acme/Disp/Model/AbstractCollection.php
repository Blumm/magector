<?php
namespace Acme\Disp\Model;

/** E13: a collection base class — the prefix set from a constructor argument */
class AbstractCollection
{
    protected $_eventPrefix = '';

    protected $_eventManager;

    protected function _afterLoad()
    {
        if ($this->_eventPrefix) {
            $this->_eventManager->dispatch(
                $this->_eventPrefix . '_load_after',
                ['collection' => $this]
            );
        }
        return $this;
    }
}
