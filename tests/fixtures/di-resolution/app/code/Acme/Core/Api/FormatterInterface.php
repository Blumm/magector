<?php
declare(strict_types=1);

namespace Acme\Core\Api;

interface FormatterInterface
{
    public function format(string $value): string;
}
