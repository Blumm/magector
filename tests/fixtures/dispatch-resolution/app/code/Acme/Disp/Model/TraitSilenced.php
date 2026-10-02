<?php
namespace Acme\Disp\Model;

/** F4: afterSave() overridden by a trait without parent:: — the event is not dispatched for it */
class TraitSilenced extends AbstractModel
{
    use SilentTrait;

    protected $_eventPrefix = 'acme_traitsilenced';
}
