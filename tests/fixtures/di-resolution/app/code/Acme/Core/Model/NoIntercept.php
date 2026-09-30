<?php
declare(strict_types=1);

namespace Acme\Core\Model;

use Magento\Framework\ObjectManager\NoninterceptableInterface;

class NoIntercept implements NoninterceptableInterface
{
    public function run(): string
    {
        return "no";
    }
}
