<?php
declare(strict_types=1);

namespace Acme\Core\Model;

use Acme\Core\Api\RichFormatterInterface;

class RichFormatter implements RichFormatterInterface
{
    public function format(string $value): string
    {
        return $value;
    }

    public function formatRich(string $value): string
    {
        return $value;
    }

    public function count(): int
    {
        return 0;
    }
}
