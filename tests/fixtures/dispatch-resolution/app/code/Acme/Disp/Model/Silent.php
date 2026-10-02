<?php
namespace Acme\Disp\Model;

/** E15: overrides afterSave() without parent:: — the event is not dispatched for it */
class Silent extends AbstractModel
{
    protected $_eventPrefix = 'acme_silent';

    public function afterSave()
    {
        return $this;
    }
}
