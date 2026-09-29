<?php
declare(strict_types=1);

namespace Acme\Api\Model;

class ReportConsumer
{
    public function __construct(private readonly \Acme\Ext\Model\Reporter $reporter)
    {
    }
}
