<?php
namespace Acme\Disp\Model;

/** F5: the constructor assigns the prefix over the declared default */
class CtorAssigned extends AbstractModel
{
    protected $_eventPrefix = 'acme_ctorprop';

    public function __construct()
    {
        $this->_eventPrefix = 'acme_ctorassigned';
    }
}
