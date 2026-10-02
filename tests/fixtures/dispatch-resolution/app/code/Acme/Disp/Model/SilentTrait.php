<?php
namespace Acme\Disp\Model;

/** F4: a trait method that replaces afterSave() without parent:: */
trait SilentTrait
{
    public function afterSave()
    {
        return $this;
    }
}
