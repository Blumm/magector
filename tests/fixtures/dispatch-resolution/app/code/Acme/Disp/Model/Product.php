<?php
namespace Acme\Disp\Model;

use Acme\Disp\Model\Catalog\AbstractCatalog;

/** E2: the prefix four levels below the site; overrides afterSave() and calls parent:: */
class Product extends AbstractCatalog
{
    protected $_eventPrefix = 'acme_product';

    public function afterSave()
    {
        $result = parent::afterSave();
        return $result;
    }
}
