<?php
declare(strict_types=1);

namespace Acme\Core\Model;

class DefaultPrice implements \Acme\Core\Api\PriceInterface
{
    public function get(): float
    {
        return 1.0;
    }
}
