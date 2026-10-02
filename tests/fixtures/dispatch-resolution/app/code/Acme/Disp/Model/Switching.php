<?php
namespace Acme\Disp\Model;

/** E14: the prefix assigned in a method too — both values are possible */
class Switching extends AbstractModel
{
    protected $_eventPrefix = 'acme_switch_a';

    public function useB()
    {
        $this->_eventPrefix = 'acme_switch_b';
        return $this;
    }
}
