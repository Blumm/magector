<?php
namespace Acme\Disp\Model;

/** F4: overridden by a trait that calls parent:: — dispatched */
class TraitLoud extends AbstractModel
{
    use LoudTrait;

    protected $_eventPrefix = 'acme_traitloud';
}
