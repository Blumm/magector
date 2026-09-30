<?php
declare(strict_types=1);

namespace Acme\Core\Api;

/** Extends two interfaces at once. */
interface RichFormatterInterface extends FormatterInterface, \Countable
{
    public function formatRich(string $value): string;
}
