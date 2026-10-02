<?php
namespace Acme\Disp\Other;

use Acme\Disp\Model\AbstractModel as Base;

/** E16: same short name in another namespace, the parent through an alias */
class AbstractModel extends Base
{
    protected $_eventPrefix = 'acme_other';
}
