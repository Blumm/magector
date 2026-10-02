<?php
namespace Acme\Disp\Model;

/** F4: the same through a nested trait */
class NestedSilenced extends AbstractModel
{
    use OuterSilentTrait;

    protected $_eventPrefix = 'acme_nestedsilenced';
}
