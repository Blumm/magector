<?php
namespace Acme\Disp\Model\ResourceModel\Grid;

use Acme\Disp\Model\AbstractCollection;

/** E13: di.xml gives eventPrefix — adminhtml for the type, every area for a virtual type over it */
class Collection extends AbstractCollection
{
    public function __construct($eventPrefix = null)
    {
        $this->_eventPrefix = $eventPrefix;
    }
}
