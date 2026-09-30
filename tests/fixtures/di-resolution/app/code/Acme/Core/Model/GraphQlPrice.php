<?php
declare(strict_types=1);

namespace Acme\Core\Model;

class GraphQlPrice implements \Acme\Core\Api\PriceInterface
{
    public function get(): float
    {
        return 2.0;
    }
}
