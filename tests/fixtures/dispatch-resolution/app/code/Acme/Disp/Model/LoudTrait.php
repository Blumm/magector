<?php
namespace Acme\Disp\Model;

/** F4: a trait method that replaces afterSave() and calls parent:: — the event still fires */
trait LoudTrait
{
    public function afterSave()
    {
        return parent::afterSave();
    }
}
