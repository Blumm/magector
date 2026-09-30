<?php
declare(strict_types=1);

namespace Acme\Core\Api;

interface PriceInterface
{
    public function get(): float;
}
