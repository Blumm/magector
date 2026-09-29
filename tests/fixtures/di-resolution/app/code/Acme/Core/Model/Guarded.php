<?php
declare(strict_types=1);

namespace Acme\Core\Model;

class Guarded
{
    public function open(): string
    {
        return "open";
    }

    final public function locked(): string
    {
        return "locked";
    }

    public static function make(): self
    {
        return new self();
    }

    private function secret(): string
    {
        return "secret";
    }
}
