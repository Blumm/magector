<?php
declare(strict_types=1);

namespace Acme\Core\Api;

interface ExporterInterface
{
    public function export(): string;
}
