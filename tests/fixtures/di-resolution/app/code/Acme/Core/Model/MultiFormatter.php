<?php
declare(strict_types=1);

namespace Acme\Core\Model;

use Acme\Core\Api\FormatterInterface as Fmt;
use Acme\Core\Api\NotifierInterface;

/** Several interfaces, one of them through an alias. */
class MultiFormatter implements \JsonSerializable, Fmt, NotifierInterface
{
    public function format(string $value): string
    {
        return $value;
    }

    public function notify(): void
    {
    }

    public function jsonSerialize(): mixed
    {
        return [];
    }
}
