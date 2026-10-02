<?php
namespace Acme\Disp\Model;

/** E3/E4: an abstract middle layer sets the prefix */
abstract class Middle extends AbstractModel
{
    protected $_eventPrefix = 'acme_middle';
}
