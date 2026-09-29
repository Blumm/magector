<?php
declare(strict_types=1);

namespace Acme\Core\Model;

class Exporter implements \Acme\Core\Api\ExporterInterface
{
    public function __construct(private readonly string $format = "csv")
    {
    }

    public function export(): string
    {
        return $this->format;
    }
}
