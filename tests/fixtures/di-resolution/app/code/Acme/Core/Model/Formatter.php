<?php
declare(strict_types=1);

namespace Acme\Core\Model;

class Formatter implements \Acme\Core\Api\FormatterInterface
{
    public function format(string $value): string
    {
        return $value;
    }
}
